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
    } catch (err) {
        res.status(500).json({ error: "검색 중 오류 발생" });
    }
});

// 순위 나열 API
app.get('/ranking/:type', async (req, res) => {
    const { type } = req.params;
    try {
        let query;
        if (type === 'hitter') {
            query = `
                SELECT p.name, p.team, 
                ((CAST(s.s1+s.s2+s.s3+s.hr AS FLOAT) + s.walks) / NULLIF((s.at_bats + s.walks), 0)) + 
                ((CAST(s.s1*1 + s.s2*2 + s.s3*3 + s.hr*4 AS FLOAT)) / NULLIF(s.at_bats, 0)) as ops
                FROM players p JOIN hitter_stats s ON p.id = s.player_id
                WHERE s.at_bats > 10 ORDER BY ops DESC LIMIT 10`;
        } else {
            query = `
                SELECT p.name, p.team, (CAST(s.earned_runs * 9 AS FLOAT) / NULLIF(s.innings_pitched, 0)) as era
                FROM players p JOIN pitcher_stats s ON p.id = s.player_id
                WHERE s.innings_pitched > 5 ORDER BY era ASC LIMIT 10`;
        }
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: "순위 로딩 실패" }); }
});

// ==========================================
// 2. 상세 스탯 조회 (단일 시즌 & 통산)
// ==========================================

// [단일 시즌] 상세 스탯 조회 (디버깅 강화 버전)
app.get('/stats/:type/:name/:year', async (req, res) => {
    const { type, name, year } = req.params;
    const table = type === 'hitter' ? 'hitter_stats' : 'pitcher_stats';
    
    try {
        const query = `
            SELECT p.name, p.team, s.* FROM players p 
            JOIN ${table} s ON p.id = s.player_id 
            WHERE p.name = $1 AND s.year = $2
        `;
        const result = await pool.query(query, [name.trim(), year]);

        if (result.rows.length === 0) {
            return res.status(404).send("해당 연도의 데이터를 찾을 수 없습니다.");
        }

        const s = result.rows[0];
        if (type === 'hitter') {
            const ab = parseInt(s.at_bats) || 1;
            const totalHits = (parseInt(s.s1) || 0) + (parseInt(s.s2) || 0) + (parseInt(s.s3) || 0) + (parseInt(s.hr) || 0);
            const avg = (totalHits / ab).toFixed(3);
            const obp = ((totalHits + (parseInt(s.walks) || 0)) / (ab + (parseInt(s.walks) || 0))).toFixed(3);
            const slg = (((parseInt(s.s1) * 1) + (parseInt(s.s2) * 2) + (parseInt(s.s3) * 3) + (parseInt(s.hr) * 4)) / ab).toFixed(3);
            const ops = (parseFloat(obp) + parseFloat(slg)).toFixed(3);
            res.send(renderHitterHTML(s, avg, obp, slg, ops, totalHits, ab));
        } else {
            const ip = parseFloat(s.innings_pitched) || 1;
            const era = ((parseInt(s.earned_runs) * 9) / ip).toFixed(2);
            const whip = ((parseInt(s.hits_allowed) + parseInt(s.walks_allowed)) / ip).toFixed(2);
            res.send
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`서버가 포트 ${port}에서 실행 중입니다.`));
