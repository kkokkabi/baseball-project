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
// 1. 검색 및 통산 기록 API
// ==========================================

// 통합 검색 (부분 일치)
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
        res.status(500).json({ error: "검색 중 오류 발생" });
    }
});

// 타자 통산 기록
app.get('/stats/hitter/career/:name', async (req, res) => {
    try {
        const { name } = req.params;
        const query = `
            SELECT p.name, p.team, COUNT(s.year) as seasons,
            SUM(s.at_bats) as ab, SUM(s.s1) as s1, SUM(s.s2) as s2, 
            SUM(s.s3) as s3, SUM(s.hr) as hr, SUM(s.walks) as bb
            FROM players p JOIN hitter_stats s ON p.id = s.player_id 
            WHERE p.name = $1 GROUP BY p.id, p.name, p.team
        `;
        const result = await pool.query(query, [name.trim()]);
        if (result.rows.length > 0) {
            const s = result.rows[0];
            const ab = parseInt(s.ab) || 1;
            const hits = parseInt(s.s1)+parseInt(s.s2)+parseInt(s.s3)+parseInt(s.hr);
            const avg = (hits / ab).toFixed(3);
            const obp = ((hits + parseInt(s.bb)) / (ab + parseInt(s.bb))).toFixed(3);
            const slg = ((parseInt(s.s1) + parseInt(s.s2)*2 + parseInt(s.s3)*3 + parseInt(s.hr)*4) / ab).toFixed(3);
            res.send(renderCareerHTML(s, '타자', `AVG: ${avg} | OPS: ${(parseFloat(obp)+parseFloat(slg)).toFixed(3)}`, '#007bff'));
        } else { res.status(404).send("기록 없음"); }
    } catch (err) { res.status(500).send("서버 오류"); }
});

// 투수 통산 기록
app.get('/stats/pitcher/career/:name', async (req, res) => {
    try {
        const { name } = req.params;
        const query = `
            SELECT p.name, p.team, COUNT(s.year) as seasons,
            SUM(s.innings_pitched) as ip, SUM(s.earned_runs) as er, SUM(s.strikeouts) as so
            FROM players p JOIN pitcher_stats s ON p.id = s.player_id 
            WHERE p.name = $1 GROUP BY p.id, p.name, p.team
        `;
        const result = await pool.query(query, [name.trim()]);
        if (result.rows.length > 0) {
            const s = result.rows[0];
            const ip = parseFloat(s.ip) || 1;
            const era = ((s.er * 9) / ip).toFixed(2);
            res.send(renderCareerHTML(s, '투수', `ERA: ${era} | SO: ${s.so}`, '#28a745'));
        } else { res.status(404).send("기록 없음"); }
    } catch (err) { res.status(500).send("서버 오류"); }
});

// ==========================================
// 2. 순위 나열 API (Top 10)
// ==========================================

app.get('/ranking/:type', async (req, res) => {
    const { type } = req.params;
    try {
        let query;
        if (type === 'hitter') {
            query = `
                SELECT p.name, p.team, 
                (CAST(s.s1+s.s2+s.s3+s.hr+s.walks AS FLOAT) / NULLIF(s.at_bats+s.walks, 0)) + 
                (CAST(s.s1+s.s2*2+s.s3*3+s.hr*4 AS FLOAT) / NULLIF(s.at_bats, 0)) as ops
                FROM players p JOIN hitter_stats s ON p.id = s.player_id
                ORDER BY ops DESC LIMIT 10`;
        } else {
            query = `
                SELECT p.name, p.team, (CAST(s.earned_runs * 9 AS FLOAT) / NULLIF(s.innings_pitched, 0)) as era
                FROM players p JOIN pitcher_stats s ON p.id = s.player_id
                WHERE s.innings_pitched > 10 ORDER BY era ASC LIMIT 10`;
        }
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: "순위 로딩 실패" }); }
});

// ==========================================
// 3. 기존 데이터 추가 및 단일 시즌 조회
// ==========================================

app.post('/add-pitcher', async (req, res) => {
    const { name, team, year, ip, er, h, bb, so } = req.body;
    try {
        const playerId = await getPlayerId(name, team);
        await pool.query('INSERT INTO pitcher_stats (player_id, year, innings_pitched, earned_runs, hits_allowed, walks_allowed, strikeouts) VALUES ($1,$2,$3,$4,$5,$6,$7)', [playerId, year, ip, er, h, bb, so]);
        res.json({ success: true, message: "투수 저장 완료" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/add-hitter', async (req, res) => {
    const { name, team, year, ab, s1, s2, s3, hr, bb } = req.body;
    try {
        const playerId = await getPlayerId(name, team);
        await pool.query('INSERT INTO hitter_stats (player_id, year, at_bats, s1, s2, s3, hr, walks) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [playerId, year, ab, s1, s2, s3, hr, bb]);
        res.json({ success: true, message: "타자 저장 완료" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 단일 시즌 조회 (기존 로직 유지)
app.get('/stats/:type/:name/:year', async (req, res) => {
    const { type, name, year } = req.params;
    const table = type === 'hitter' ? 'hitter_stats' : 'pitcher_stats';
    try {
        const query = `SELECT p.name, p.team, s.* FROM players p JOIN ${table} s ON p.id = s.player_id WHERE p.name = $1 AND s.year = $2`;
        const result = await pool.query(query, [name.trim(), year]);
        if (result.rows.length > 0) {
            const s = result.rows[0];
            if (type === 'hitter') {
                const totalHits = (s.s1 || 0) + (s.s2 || 0) + (s.s3 || 0) + (s.hr || 0);
                const avg = (totalHits / (s.at_bats || 1)).toFixed(3);
                res.send(renderHitterHTML(s, avg, "계산된 OBP", "SLG", "OPS", totalHits, s.at_bats));
            } else {
                const era = ((s.earned_runs * 9) / (s.innings_pitched || 1)).toFixed(2);
                res.send(renderPitcherHTML(s, era, "WHIP", s.innings_pitched));
            }
        } else { res.status(404).send("데이터 없음"); }
    } catch (err) { res.status(500).send("서버 오류"); }
});

// ==========================================
// 4. HTML 렌더링 함수
// ==========================================

function renderCareerHTML(s, type, stats, color) {
    return `
        <div style="font-family: sans-serif; padding: 20px; max-width: 500px; margin: auto; border: 4px double ${color}; border-radius: 10px;">
            <h2 style="text-align: center;">🏆 ${s.name} 통산 (${type})</h2>
            <p style="text-align: center;">소속: ${s.team} | ${s.seasons}시즌 활약</p><hr>
            <div style="background: #f9f9f9; padding: 15px; border-radius: 8px; text-align: center;">
                <h3 style="color: ${color};">${stats}</h3>
            </div><hr>
            <button onclick="window.history.back()" style="width: 100%; padding: 10px;">뒤로가기</button>
        </div>`;
}

// ... 기존 renderPitcherHTML, renderHitterHTML 함수들 유지 ...

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`서버가 포트 ${port}에서 실행 중입니다.`));
