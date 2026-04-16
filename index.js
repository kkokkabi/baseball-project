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
// [신규] 검색 기능 개선 API (부분 일치 & 통합 검색)
// ==========================================
app.get('/search/player/:name', async (req, res) => {
    try {
        const searchTerm = `%${req.params.name.trim()}%`; 
        const query = `
            SELECT p.name, p.team, s.year, 'hitter' as type 
            FROM players p 
            JOIN hitter_stats s ON p.id = s.player_id 
            WHERE p.name LIKE $1
            UNION ALL
            SELECT p.name, p.team, s.year, 'pitcher' as type 
            FROM players p 
            JOIN pitcher_stats s ON p.id = s.player_id 
            WHERE p.name LIKE $1
            ORDER BY year DESC, name ASC
        `;
        const result = await pool.query(query, [searchTerm]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "검색 중 오류가 발생했습니다." });
    }
});

// --- [투수 섹션] ---
app.post('/add-pitcher', async (req, res) => {
    const { name, team, year, ip, er, h, bb, so } = req.body;
    try {
        const playerId = await getPlayerId(name, team);
        await pool.query(
            'INSERT INTO pitcher_stats (player_id, year, innings_pitched, earned_runs, hits_allowed, walks_allowed, strikeouts) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [playerId, year, ip, er, h, bb, so]
        );
        res.json({ success: true, message: `${name} 투수의 ${year}년 데이터 저장 완료!` });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/stats/pitcher/:name/:year', async (req, res) => {
    try {
        const { name, year } = req.params;
        const query = `
            SELECT p.name, p.team, s.* FROM players p 
            JOIN pitcher_stats s ON p.id = s.player_id 
            WHERE p.name = $1 AND s.year = $2
        `;
        const result = await pool.query(query, [name.trim(), year]);
        if (result.rows.length > 0) {
            const s = result.rows[0];
            const ip = parseFloat(s.innings_pitched) || 1;
            const era = ((s.earned_runs * 9) / ip).toFixed(2);
            const whip = ((s.hits_allowed + s.walks_allowed) / ip).toFixed(2);
            res.send(renderPitcherHTML(s, era, whip, ip));
        } else { res.status(404).send("데이터를 찾을 수 없습니다."); }
    } catch (err) { res.status(500).send("서버 오류"); }
});

// --- [타자 섹션] ---
app.post('/add-hitter', async (req, res) => {
    const { name, team, year, ab, s1, s2, s3, hr, bb } = req.body;
    try {
        const playerId = await getPlayerId(name, team);
        await pool.query(
            'INSERT INTO hitter_stats (player_id, year, at_bats, s1, s2, s3, hr, walks) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
            [playerId, year, ab, s1, s2, s3, hr, bb]
        );
        res.json({ success: true, message: `${name} 타자의 ${year}년 데이터 저장 완료!` });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/stats/hitter/:name/:year', async (req, res) => {
    try {
        const { name, year } = req.params;
        const query = `
            SELECT p.name, p.team, s.* FROM players p 
            JOIN hitter_stats s ON p.id = s.player_id 
            WHERE p.name = $1 AND s.year = $2
        `;
        const result = await pool.query(query, [name.trim(), year]);
        if (result.rows.length > 0) {
            const s = result.rows[0];
            const ab = parseInt(s.at_bats) || 1;
            const totalHits = (s.s1 || 0) + (s.s2 || 0) + (s.s3 || 0) + (s.hr || 0);
            const avg = (totalHits / ab).toFixed(3);
            const obp = ((totalHits + (s.walks || 0)) / (ab + (s.walks || 0))).toFixed(3);
            const slg = (((s.s1 * 1) + (s.s2 * 2) + (s.s3 * 3) + (s.hr * 4)) / ab).toFixed(3);
            const ops = (parseFloat(obp) + parseFloat(slg)).toFixed(3);
            res.send(renderHitterHTML(s, avg, obp, slg, ops, totalHits, ab));
        } else { res.status(404).send("데이터를 찾을 수 없습니다."); }
    } catch (err) { res.status(500).send("서버 오류"); }
});

// --- HTML 렌더링 함수 (코드 가독성을 위해 분리) ---
function renderPitcherHTML(s, era, whip, ip) {
    return `
        <div style="font-family: sans-serif; padding: 20px; max-width: 500px; margin: auto; border: 2px solid #28a745; border-radius: 10px;">
            <h2 style="text-align: center;">⚾ 투수 ${s.name} (${s.year})</h2>
            <p style="text-align: center;">소속: ${s.team}</p><hr>
            <div style="background: #f0fff0; padding: 15px; border-radius: 8px;">
                <p><b>ERA:</b> <span style="color: red;">${era}</span></p>
                <p><b>WHIP:</b> ${whip}</p>
                <p><b>SO:</b> ${s.strikeouts}</p>
            </div><hr>
            <button onclick="window.history.back()" style="width: 100%; padding: 10px;">뒤로가기</button>
        </div>`;
}

function renderHitterHTML(s, avg, obp, slg, ops, totalHits, ab) {
    return `
        <div style="font-family: sans-serif; padding: 20px; max-width: 500px; margin: auto; border: 2px solid #007bff; border-radius: 10px;">
            <h2 style="text-align: center;">⚾ 타자 ${s.name} (${s.year})</h2>
            <p style="text-align: center;">소속: ${s.team}</p><hr>
            <div style="background: #f0f7ff; padding: 15px; border-radius: 8px;">
                <p><b>AVG:</b> ${avg} | <b>OBP:</b> ${obp}</p>
                <p><b>SLG:</b> ${slg} | <b style="color:blue;">OPS: ${ops}</b></p>
            </div><hr>
            <button onclick="window.history.back()" style="width: 100%; padding: 10px;">뒤로가기</button>
        </div>`;
}

const port = process.env.PORT ||
