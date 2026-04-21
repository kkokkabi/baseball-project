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
// 1. 검색 및 순위 기능
// ==========================================

// 통합 검색 API
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

// 타자 순위 API (타율/출루율 계산 시 s1만 반영하는 규칙 적용)
app.get('/ranking/hitter', async (req, res) => {
    try {
        const query = `
            SELECT p.name, p.team, 
            ((CAST(s.s1 AS FLOAT) + s.walks) / NULLIF((s.at_bats + s.walks), 0)) + 
            ((CAST(s.s1*1 + s.s2*2 + s.s3*3 + s.hr*4 AS FLOAT)) / NULLIF(s.at_bats, 0)) as ops
            FROM players p JOIN hitter_stats s ON p.id = s.player_id
            WHERE s.at_bats > 10 ORDER BY ops DESC LIMIT 10`;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: "순위 로딩 실패" }); }
});

// ==========================================
// 2. 상세 스탯 조회 (단일 시즌)
// ==========================================

app.get('/stats/hitter/:name/:year', async (req, res) => {
    try {
        const { name, year } = req.params;
        const query = `SELECT p.name, p.team, s.* FROM players p JOIN hitter_stats s ON p.id = s.player_id WHERE p.name = $1 AND s.year = $2`;
        const result = await pool.query(query, [name.trim(), year]);
        if (result.rows.length === 0) return res.status(404).send("데이터 없음");

        const s = result.rows[0];
        const ab = parseInt(s.at_bats) || 1;
        const walks = parseInt(s.walks) || 0;
        
        // [규칙 적용] 타율/출루율용 안타(pureHits)는 s1만 사용
        const pureHits = parseInt(s.s1) || 0; 
        
        const avg = (pureHits / ab).toFixed(3);
        const obp = ((pureHits + walks) / (ab + walks)).toFixed(3);
        const slg = (((parseInt(s.s1) * 1) + (parseInt(s.s2) * 2) + (parseInt(s.s3) * 3) + (parseInt(s.hr) * 4)) / ab).toFixed(3);
        const ops = (parseFloat(obp) + parseFloat(slg)).toFixed(3);

        res.send(renderHitterHTML(s, avg, obp, slg, ops, pureHits, ab));
    } catch (err) { res.status(500).send(`오류: ${err.message}`); }
});

// ==========================================
// 3. 통산 기록 조회 (s1 기반 계산)
// ==========================================

app.get('/stats/hitter/career/:name', async (req, res) => {
    try {
        const { name } = req.params;
        const query = `
            SELECT p.name, p.team, COUNT(s.year) as seasons, SUM(s.games_played) as total_gp,
            SUM(s.at_bats) as ab, SUM(s.s1) as pure_hits, SUM(s.hr) as total_hr
            FROM players p JOIN hitter_stats s ON p.id = s.player_id 
            WHERE p.name = $1 GROUP BY p.id, p.name, p.team`;
        const result = await pool.query(query, [name.trim()]);
        
        if (result.rows.length > 0) {
            const s = result.rows[0];
            const content = `통산 ${s.total_gp || 0}경기 | 순수 안타(s1): ${s.pure_hits} | 홈런: ${s.total_hr} | 타석: ${s.ab}`;
            res.send(renderCareerHTML(s, '타자', content, '#007bff'));
        } else { res.status(404).send("기록 없음"); }
    } catch (err) { res.status(500).send("서버 오류"); }
});

// ==========================================
// 4. 데이터 추가 (POST)
// ==========================================

app.post('/add-hitter', async (req, res) => {
    const { name, team, year, ab, s1, s2, s3, hr, bb, gp } = req.body;
    try {
        const playerId = await getPlayerId(name, team);
        await pool.query('INSERT INTO hitter_stats (player_id, year, at_bats, s1, s2, s3, hr, walks, games_played) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', 
            [playerId, year, ab, s1, s2, s3, hr, bb, gp || 0]);
        res.json({ success: true, message: "타자 저장 완료" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// 5. HTML 렌더링 함수
// ==========================================

function renderHitterHTML(s, avg, obp, slg, ops, pureHits, ab) {
    return `
        <div style="font-family: sans-serif; padding: 20px; max-width: 500px; margin: auto; border: 2px solid #007bff; border-radius: 10px;">
            <h2 style="text-align: center;">⚾ 타자 ${s.name} (${s.year})</h2>
            <p style="text-align: center;">소속: ${s.team} | 경기수: ${s.games_played || 0}</p><hr>
            <div style="background: #f0f7ff; padding: 15px; border-radius: 8px;">
                <p><b>AVG (타율):</b> <span style="color: blue;">${avg}</span></p>
                <p><b>OBP (출루율):</b> ${obp}</p>
                <p><b>SLG (장타율):</b> ${slg}</p>
                <p><b>OPS:</b> <b style="font-size: 1.2em;">${ops}</b></p>
                <hr>
                <p style="font-size: 0.85em; color: #555;">
                    * 타율/출루율은 <b>순수 안타(${pureHits}개)</b>로 계산되었습니다.<br>
                    * 2루타(${s.s2}), 3루타(${s.s3}), 홈런(${s.hr})은 장타율에만 반영됩니다.
                </p>
            </div><hr>
            <button onclick="window.history.back()" style="width: 100%; padding: 10px; cursor: pointer;">뒤로가기</button>
        </div>`;
}

function renderCareerHTML(s, type, content, color) {
    return `
        <div style="font-family: sans-serif; padding: 20px; max-width: 500px; margin: auto; border: 4px double ${color}; border-radius: 15px;">
            <h2 style="text-align: center;">🏆 ${s.name} 통산 (${type})</h2>
            <p style="text-align: center;">소속: ${s.team} | ${s.seasons}시즌 활약</p><hr>
            <div style="background: #f8f9fa; padding: 20px; border-radius: 10px; text-align: center;">
                <h4 style="margin: 0;">${content}</h4>
            </div><hr>
            <button onclick="window.history.back()" style="width: 100%; padding: 10px; cursor: pointer;">뒤로가기</button>
        </div>`;
}

// ... (투수 관련 API 및 렌더링 함수는 이전과 동일하게 유지) ...

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`서버가 포트 ${port}에서 실행 중입니다.`));
