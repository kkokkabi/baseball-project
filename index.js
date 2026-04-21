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

// 타자 OPS 순위 API (안타 합산 반영)
app.get('/ranking/hitter', async (req, res) => {
    try {
        const query = `
            SELECT p.name, p.team, 
            ((CAST(s.s1+s.s2+s.s3+s.hr AS FLOAT) + s.walks) / NULLIF((s.at_bats + s.walks), 0)) + 
            ((CAST(s.s1*1 + s.s2*2 + s.s3*3 + s.hr*4 AS FLOAT)) / NULLIF(s.at_bats, 0)) as ops
            FROM players p JOIN hitter_stats s ON p.id = s.player_id
            WHERE s.at_bats > 10 ORDER BY ops DESC LIMIT 10`;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: "순위 로딩 실패" }); }
});

// 투수 ERA 순위 API
app.get('/ranking/pitcher', async (req, res) => {
    try {
        const query = `
            SELECT p.name, p.team, (CAST(s.earned_runs * 9 AS FLOAT) / NULLIF(s.innings_pitched, 0)) as era
            FROM players p JOIN pitcher_stats s ON p.id = s.player_id
            WHERE s.innings_pitched > 5 ORDER BY era ASC LIMIT 10`;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: "순위 로딩 실패" }); }
});

// ==========================================
// 2. 상세 스탯 및 통산 기록 조회
// ==========================================

// [타자] 단일 시즌 상세 조회
app.get('/stats/hitter/:name/:year', async (req, res) => {
    try {
        const { name, year } = req.params;
        const query = `SELECT p.name, p.team, s.* FROM players p JOIN hitter_stats s ON p.id = s.player_id WHERE p.name = $1 AND s.year = $2`;
        const result = await pool.query(query, [name.trim(), year]);
        if (result.rows.length === 0) return res.status(404).send("데이터 없음");

        const s = result.rows[0];
        const ab = parseInt(s.at_bats) || 1;
        const totalHits = (parseInt(s.s1) || 0) + (parseInt(s.s2) || 0) + (parseInt(s.s3) || 0) + (parseInt(s.hr) || 0);
        const avg = (totalHits / ab).toFixed(3);
        const obp = ((totalHits + (parseInt(s.walks) || 0)) / (ab + (parseInt(s.walks) || 0))).toFixed(3);
        const slg = (((parseInt(s.s1) * 1) + (parseInt(s.s2) * 2) + (parseInt(s.s3) * 3) + (parseInt(s.hr) * 4)) / ab).toFixed(3);
        const ops = (parseFloat(obp) + parseFloat(slg)).toFixed(3);

        res.send(renderHitterHTML(s, avg, obp, slg, ops, totalHits, ab));
    } catch (err) { res.status(500).send(`오류: ${err.message}`); }
});

// [투수] 단일 시즌 상세 조회
app.get('/stats/pitcher/:name/:year', async (req, res) => {
    try {
        const { name, year } = req.params;
        const query = `SELECT p.name, p.team, s.* FROM players p JOIN pitcher_stats s ON p.id = s.player_id WHERE p.name = $1 AND s.year = $2`;
        const result = await pool.query(query, [name.trim(), year]);
        if (result.rows.length === 0) return res.status(404).send("데이터 없음");

        const s = result.rows[0];
        const ip = parseFloat(s.innings_pitched) || 1;
        const era = ((parseInt(s.earned_runs) * 9) / ip).toFixed(2);
        const whip = ((parseInt(s.hits_allowed) + parseInt(s.walks_allowed)) / ip).toFixed(2);

        res.send(renderPitcherHTML(s, era, whip, ip));
    } catch (err) { res.status(500).send(`오류: ${err.message}`); }
});

// [통합] 통산 기록 조회 (타자/투수 구분)
app.get('/stats/:type/career/:name', async (req, res) => {
    const { type, name } = req.params;
    try {
        let query;
        if (type === 'hitter') {
            query = `
                SELECT p.name, p.team, COUNT(s.year) as seasons, SUM(s.games_played) as total_gp,
                SUM(s.at_bats) as ab, SUM(s.s1 + s.s2 + s.s3 + s.hr) as total_hits, SUM(s.hr) as total_hr
                FROM players p JOIN hitter_stats s ON p.id = s.player_id 
                WHERE p.name = $1 GROUP BY p.id, p.name, p.team`;
        } else {
            query = `
                SELECT p.name, p.team, COUNT(s.year) as seasons, SUM(s.games_played) as total_gp,
                SUM(s.innings_pitched) as ip, SUM(s.earned_runs) as er, SUM(s.strikeouts) as so
                FROM players p JOIN pitcher_stats s ON p.id = s.player_id 
                WHERE p.name = $1 GROUP BY p.id, p.name, p.team`;
        }
        const result = await pool.query(query, [name.trim()]);
        if (result.rows.length > 0) {
            const s = result.rows[0];
            const content = type === 'hitter' 
                ? `통산 ${s.total_gp || 0}경기 | 안타: ${s.total_hits} | 홈런: ${s.total_hr} | 타석: ${s.ab}` 
                : `통산 ${s.total_gp || 0}경기 | 이닝: ${s.ip} | 탈삼진: ${s.so} | ERA: ${((s.er*9)/s.ip).toFixed(2)}`;
            res.send(renderCareerHTML(s, type === 'hitter' ? '타자' : '투수', content, type === 'hitter' ? '#007bff' : '#28a745'));
        } else { res.status(404).send("기록 없음"); }
    } catch (err) { res.status(500).send("서버 오류"); }
});

// ==========================================
// 3. 데이터 추가 (POST)
// ==========================================

app.post('/add-pitcher', async (req, res) => {
    const { name, team, year, ip, er, h, bb, so, gp } = req.body;
    try {
        const playerId = await getPlayerId(name, team);
        await pool.query('INSERT INTO pitcher_stats (player_id, year, innings_pitched, earned_runs, hits_allowed, walks_allowed, strikeouts, games_played) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', 
            [playerId, year, ip, er, h, bb, so, gp || 0]);
        res.json({ success: true, message: "투수 저장 완료" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

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
// 4. HTML 렌더링 함수
// ==========================================

function renderHitterHTML(s, avg, obp, slg, ops, totalHits, ab) {
    return `
        <div style="font-family: sans-serif; padding: 20px; max-width: 500px; margin: auto; border: 2px solid #007bff; border-radius: 10px;">
            <h2 style="text-align: center;">⚾ 타자 ${s.name} (${s.year})</h2>
            <p style="text-align: center;">소속: ${s.team} | 경기수: ${s.games_played || 0}</p><hr>
            <div style="background: #f0f7ff; padding: 15px; border-radius: 8px;">
                <p><b>AVG (타율):</b> <span style="color: blue;">${avg}</span> (${totalHits}안타 / ${ab}타수)</p>
                <p><b>OBP:</b> ${obp} | <b>SLG:</b> ${slg}</p>
                <p><b>OPS:</b> <b>${ops}</b></p>
                <p style="font-size: 0.9em; color: #666;">* 안타 수에는 2루타, 3루타, 홈런이 포함되어 있습니다.</p>
            </div><hr>
            <button onclick="window.history.back()" style="width: 100%; padding: 10px;">뒤로가기</button>
        </div>`;
}

function renderPitcherHTML(s, era, whip, ip) {
    return `
        <div style="font-family: sans-serif; padding: 20px; max-width: 500px; margin: auto; border: 2px solid #28a745; border-radius: 10px;">
            <h2 style="text-align: center;">⚾ 투수 ${s.name} (${s.year})</h2>
            <p style="text-align: center;">소속: ${s.team} | 경기수: ${s.games_played || 0}</p><hr>
            <div style="background: #f0fff0; padding: 15px; border-radius: 8px;">
                <p><b>ERA:</b> <span style="color: red;">${era}</span></p>
                <p><b>WHIP:</b> ${whip}</p>
                <p><b>SO (탈삼진):</b> ${s.strikeouts}</p>
            </div><hr>
            <button onclick="window.history.back()" style="width: 100%; padding: 10px;">뒤로가기</button>
        </div>`;
}

function renderCareerHTML(s, type, content, color) {
    return `
        <div style="font-family: sans-serif; padding: 20px; max-width: 500px; margin: auto; border: 4px double ${color}; border-radius: 15px;">
            <h2 style="text-align: center;">🏆 ${s.name} 통산 (${type})</h2>
            <p style="text-align: center;">소속: ${s.team} | ${s.seasons}시즌 활약</p><hr>
            <div style="background: #f8f9fa; padding: 20px; border-radius: 10px; text-align: center;">
                <h4>${content}</h4>
            </div><hr>
            <button onclick="window.history.back()" style="width: 100%; padding: 10px;">뒤로가기</button>
        </div>`;
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`서버가 포트 ${port}에서 실행 중입니다.`));
