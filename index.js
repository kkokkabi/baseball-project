require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');

const app = express();
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(express.static('public'));
app.use(express.json());

// [공통 함수] 선수 확인 및 ID 반환
async function getPlayerId(name, team) {
    const check = await pool.query('SELECT id FROM players WHERE name = $1', [name]);
    if (check.rows.length > 0) return check.rows[0].id;
    const insert = await pool.query(
        'INSERT INTO players (name, team) VALUES ($1, $2) RETURNING id',
        [name, team]
    );
    return insert.rows[0].id;
}

// ==========================================
// 1. 통합 검색 및 순위 기능
// ==========================================

app.get('/search/player/:name', async (req, res) => {
    try {
        const searchTerm = `%${req.params.name.trim()}%`; 
        const query = `
            SELECT p.name, p.team, s.year, 'hitter' as type 
            FROM players p JOIN hitter_stats s ON p.id = s.player_id 
            WHERE p.name LIKE $1
            UNION ALL
            SELECT p.name, p.team, s.year, 'pitcher' as type 
            FROM players p JOIN pitcher_stats s ON p.id = s.player_id 
            WHERE p.name LIKE $1
            ORDER BY year DESC, name ASC
        `;
        const result = await pool.query(query, [searchTerm]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: "검색 중 오류 발생" }); }
});

// 타자 순위 (s1 기반 규칙 엄격 적용)
app.get('/ranking/hitter', async (req, res) => {
    try {
        const query = `
            SELECT p.name, p.team, 
            (
                ((CAST(s.s1 AS FLOAT) + s.walks) / NULLIF((s.at_bats + s.walks), 0)) + 
                ((CAST(s.s1*1 + s.s2*2 + s.s3*3 + s.hr*4 AS FLOAT)) / NULLIF(s.at_bats, 0))
            ) as ops
            FROM players p JOIN hitter_stats s ON p.id = s.player_id
            WHERE s.at_bats > 10 
            ORDER BY ops DESC LIMIT 10`;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: "순위 로딩 실패" }); }
});

// ==========================================
// 2. 타자 상세 (s1 전용 타율/출루율)
// ==========================================

app.get('/stats/hitter/:name/:year', async (req, res) => {
    try {
        const { name, year } = req.params;
        const query = `SELECT p.name, p.team, s.* FROM players p JOIN hitter_stats s ON p.id = s.player_id WHERE p.name = $1 AND s.year = $2`;
        const result = await pool.query(query, [name.trim(), year]);
        if (result.rows.length === 0) return res.status(404).send("데이터 없음");

        const s = result.rows[0];
        const ab = Number(s.at_bats) || 1;
        const walks = Number(s.walks) || 0;
        const s1 = Number(s.s1) || 0;
        const s2 = Number(s.s2) || 0;
        const s3 = Number(s.s3) || 0;
        const hr = Number(s.hr) || 0;

        const avg = (s1 / ab).toFixed(3);
        const obp = ((s1 + walks) / (ab + walks)).toFixed(3);
        const slg = ((s1 * 1 + s2 * 2 + s3 * 3 + hr * 4) / ab).toFixed(3);
        const ops = (parseFloat(obp) + parseFloat(slg)).toFixed(3);

        res.send(renderHitterHTML(s, avg, obp, slg, ops, s1));
    } catch (err) { res.status(500).send(`오류: ${err.message}`); }
});

// ==========================================
// 3. 투수 상세 (BB/9 출력 보강)
// ==========================================

app.get('/stats/pitcher/:name/:year', async (req, res) => {
    try {
        const { name, year } = req.params;
        const query = `SELECT p.name, p.team, s.* FROM players p JOIN pitcher_stats s ON p.id = s.player_id WHERE p.name = $1 AND s.year = $2`;
        const result = await pool.query(query, [name.trim(), year]);
        
        if (result.rows.length === 0) return res.status(404).send("투수 데이터 없음");

        const s = result.rows[0];
        
        // [수정 포인트] DB 컬럼명이 walks일 수도 있고 bb일 수도 있으므로 둘 다 확인합니다.
        const walks = Number(s.walks !== undefined ? s.walks : s.bb) || 0;
        const ip = Number(s.innings_pitched) || 0.1; 
        const er = Number(s.earned_runs) || 0;
        const hits = Number(s.hits_allowed) || 0;
        const strikeouts = Number(s.strikeouts) || 0;

        const era = ((er * 9) / ip).toFixed(2);
        const whip = ((hits + walks) / ip).toFixed(2);
        const k9 = ((strikeouts * 9) / ip).toFixed(2);
        const bb9 = ((walks * 9) / ip).toFixed(2);

        res.send(renderPitcherHTML(s, era, whip, k9, bb9, walks));
    } catch (err) { res.status(500).send(`오류: ${err.message}`); }
});

// ==========================================
// 4. 데이터 추가 (POST)
// ==========================================

app.post('/add-pitcher', async (req, res) => {
    const { name, team, year, wins, losses, ip, er, so, hits, bb } = req.body;
    try {
        const playerId = await getPlayerId(name, team);
        // DB 테이블의 컬럼명이 walks라면 아래처럼, bb라면 bb로 고쳐야 합니다.
        await pool.query(
            `INSERT INTO pitcher_stats (player_id, year, wins, losses, innings_pitched, earned_runs, strikeouts, hits_allowed, walks) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, 
            [playerId, year, wins, losses, ip, er, so, hits, bb]
        );
        res.json({ success: true, message: "투수 저장 완료" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// 5. HTML 렌더링 함수
// ==========================================

function renderHitterHTML(s, avg, obp, slg, ops, s1) {
    return `
        <div style="font-family: sans-serif; padding: 20px; max-width: 500px; margin: auto; border: 2px solid #007bff; border-radius: 10px;">
            <h2 style="text-align: center;">⚾ 타자 ${s.name} (${s.year})</h2>
            <p style="text-align: center;">소속: ${s.team}</p><hr>
            <div style="background: #f0f7ff; padding: 15px; border-radius: 8px;">
                <p><b>AVG (타율):</b> <span style="color: blue;">${avg}</span></p>
                <p><b>OBP (출루율):</b> ${obp}</p>
                <p><b>OPS:</b> <b style="font-size: 1.2em;">${ops}</b></p>
                <hr>
                <p style="font-size: 0.85em; color: #555;">* 타율은 <b>순수 단타(${s1}개)</b>로 계산됨</p>
            </div><hr>
            <button onclick="window.history.back()" style="width: 100%; padding: 10px; cursor: pointer;">뒤로가기</button>
        </div>`;
}

function renderPitcherHTML(s, era, whip, k9, bb9, walks) {
    return `
        <div style="font-family: sans-serif; padding: 20px; max-width: 500px; margin: auto; border: 2px solid #28a745; border-radius: 10px;">
            <h2 style="text-align: center;">⚾ 투수 ${s.name} (${s.year})</h2>
            <p style="text-align: center;">소속: ${s.team} | ${s.wins}승 ${s.losses}패</p><hr>
            <div style="background: #f0fff4; padding: 15px; border-radius: 8px;">
                <p><b>ERA (방어율):</b> <b style="color: #d9534f; font-size: 1.2em;">${era}</b></p>
                <p><b>WHIP:</b> ${whip}</p>
                <hr>
                <div style="display: flex; justify-content: space-between; background: #fff; padding: 10px; border: 1px solid #ddd; border-radius: 5px;">
                    <p style="margin:0;"><b>K/9:</b> ${k9}</p>
                    <p style="margin:0;"><b>BB/9:</b> <span style="color: #cc6600; font-weight: bold;">${bb9}</span></p>
                </div>
                <p style="margin-top:10px;"><b>허용 볼넷:</b> ${walks}개 | <b>이닝:</b> ${s.innings_pitched}</p>
            </div><hr>
            <button onclick="window.history.back()" style="width: 100%; padding: 10px; cursor: pointer;">뒤로가기</button>
        </div>`;
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`서버 실행 중: ${port}`));
