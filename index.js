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

// [선수 확인 및 ID 반환 공통 함수]
async function getPlayerId(name, team) {
    let playerCheck = await pool.query('SELECT id FROM players WHERE name = $1', [name]);
    if (playerCheck.rows.length > 0) return playerCheck.rows[0].id;
    
    const newPlayer = await pool.query(
        'INSERT INTO players (name, team) VALUES ($1, $2) RETURNING id',
        [name, team]
    );
    return newPlayer.rows[0].id;
}

// [1. 투수 데이터 추가 API]
app.post('/add-pitcher', async (req, res) => {
    const { name, team, year, ip, er, h, bb, so } = req.body;
    try {
        const playerId = await getPlayerId(name, team);
        await pool.query(
            'INSERT INTO pitcher_stats (player_id, year, innings_pitched, earned_runs, hits_allowed, walks_allowed, strikeouts) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [playerId, year, ip, er, h, bb, so]
        );
        res.json({ success: true, message: `${name} 투수의 ${year}년 데이터 저장 완료!` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [2. 투수 성적 조회 API (ERA, WHIP 계산)]
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
            
            // --- 투수 지표 계산 ---
            const ip = parseFloat(s.innings_pitched) || 1;
            // ERA (방어율): (자책점 * 9) / 이닝
            const era = ((s.earned_runs * 9) / ip).toFixed(2);
            // WHIP (이닝당 출루허용): (피안타 + 볼넷) / 이닝
            const whip = ((s.hits_allowed + s.walks_allowed) / ip).toFixed(2);

            res.send(`
                <div style="font-family: sans-serif; padding: 20px; max-width: 500px; margin: auto; border: 2px solid #28a745; border-radius: 10px;">
                    <h2 style="text-align: center;">⚾ 투수 ${s.name} (${s.year}년)</h2>
                    <p style="text-align: center;">소속: ${s.team}</p>
                    <hr>
                    <div style="background: #f0fff0; padding: 15px; border-radius: 8px;">
                        <p><b>평균자책점 (ERA):</b> <span style="font-size: 1.2em; color: red;">${era}</span></p>
                        <p><b>WHIP:</b> ${whip}</p>
                        <p><b>탈삼진 (SO):</b> ${s.strikeouts}</p>
                    </div>
                    <hr>
                    <p>상세: ${ip}이닝 ${s.earned_runs}자책 ${s.hits_allowed}피안타</p>
                    <button onclick="window.history.back()" style="width: 100%; padding: 10px; cursor: pointer;">뒤로가기</button>
                </div>
            `);
        } else {
            res.status(404).send("투수 데이터를 찾을 수 없습니다.");
        }
    } catch (err) {
        res.status(500).send("서버 오류");
    }
});

// (기존 타자 API는 그대로 유지하세요...)

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`서버 작동 중: ${port}`));
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');

const app = express();

// DB 연결 설정 (Neon / Render 환경 변수 사용)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// 미들웨어 설정
app.use(express.static('public')); 
app.use(express.json());

// [1. 선수 및 연도별 성적 데이터 추가 API]
app.post('/add-player', async (req, res) => {
    // 프론트엔드에서 year(연도)를 추가로 보내줘야 합니다.
    const { name, team, year, ab, s1, s2, s3, hr, bb } = req.body;

    try {
        // 1) 기존에 등록된 선수인지 이름으로 확인
        let playerCheck = await pool.query('SELECT id FROM players WHERE name = $1', [name]);
        let playerId;

        if (playerCheck.rows.length > 0) {
            // 이미 존재하는 선수라면 해당 ID 사용
            playerId = playerCheck.rows[0].id;
        } else {
            // 새로운 선수라면 players 테이블에 먼저 저장
            const newPlayer = await pool.query(
                'INSERT INTO players (name, team) VALUES ($1, $2) RETURNING id',
                [name, team]
            );
            playerId = newPlayer.rows[0].id;
        }

        // 2) 해당 선수의 '특정 연도' 성적 저장
        // (주의: DB에 year 컬럼이 추가되어 있어야 합니다)
        await pool.query(
            'INSERT INTO hitter_stats (player_id, year, at_bats, s1, s2, s3, hr, walks) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
            [playerId, year, ab, s1, s2, s3, hr, bb]
        );

        res.json({ success: true, message: `${name} 선수의 ${year}년 데이터 저장 완료!` });
    } catch (err) {
        console.error('데이터 저장 에러:', err);
        res.status(500).json({ error: err.message });
    }
});

// [2. 특정 선수의 특정 연도 세이버메트릭스 조회 API]
// 예: /stats/김광현/2024
app.get('/stats/:name/:year', async (req, res) => {
    try {
        const playerName = req.params.name.trim();
        const searchYear = req.params.year;

        const query = `
            SELECT p.name, p.team, s.year, s.at_bats, s.s1, s.s2, s.s3, s.hr, s.walks 
            FROM players p 
            JOIN hitter_stats s ON p.id = s.player_id 
            WHERE p.name = $1 AND s.year = $2
        `;
        
        const result = await pool.query(query, [playerName, searchYear]);

        if (result.rows.length > 0) {
            const s = result.rows[0];
            
            // --- 세이버메트릭스 계산 로직 ---
            const totalHits = (s.s1 || 0) + (s.s2 || 0) + (s.s3 || 0) + (s.hr || 0);
            const ab = s.at_bats || 1; 
            const walks = s.walks || 0;

            const avg = (totalHits / ab).toFixed(3);
            const obp = ((totalHits + walks) / (ab + walks)).toFixed(3);
            const totalBases = (s.s1 * 1) + (s.s2 * 2) + (s.s3 * 3) + (s.hr * 4);
            const slg = (totalBases / ab).toFixed(3);
            const ops = (parseFloat(obp) + parseFloat(slg)).toFixed(3);

            res.send(`
                <div style="font-family: sans-serif; padding: 20px; line-height: 1.6; max-width: 500px; margin: auto; border: 1px solid #ddd; border-radius: 10px;">
                    <h2 style="text-align: center;">⚾ ${s.name} (${s.year}년)</h2>
                    <p style="text-align: center; color: gray;">소속팀: ${s.team}</p>
                    <hr>
                    <div style="background: #f9f9f9; padding: 15px; border-radius: 8px;">
                        <p><b>타율 (AVG):</b> ${avg}</p>
                        <p><b>출루율 (OBP):</b> ${obp}</p>
                        <p><b>장타율 (SLG):</b> ${slg}</p>
                        <p style="font-size: 1.4em; color: blue;"><b>OPS: ${ops}</b></p>
                    </div>
                    <hr>
                    <p style="font-size: 0.9em;">상세: ${ab}타수 ${totalHits}안타 ${s.hr}홈런 ${walks}볼넷</p>
                    <button onclick="window.history.back()" style="width: 100%; padding: 10px; margin-top: 10px; cursor: pointer;">뒤로가기</button>
                </div>
            `);
        } else {
            res.status(404).send(`
                <div style="text-align: center; padding: 50px;">
                    <h2>데이터를 찾을 수 없습니다.</h2>
                    <p>${playerName} 선수의 ${searchYear}년 기록이 등록되지 않았습니다.</p>
                    <button onclick="window.history.back()">돌아가기</button>
                </div>
            `);
        }
    } catch (err) {
        console.error('조회 에러:', err);
        res.status(500).send("서버 내부 오류가 발생했습니다.");
    }
});

// 서버 실행
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`서버가 포트 ${port}에서 실행 중입니다.`));
