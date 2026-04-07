// 1. 설정 및 모듈 불러오기 (최상단)
require('dotenv').config();
const express = require('express');
const { Client } = require('pg');

// 2. 앱 초기화 (반드시 사용하기 전에 선언!)
const app = express();
const connectionString = process.env.DATABASE_URL;

// 3. 미들웨어 설정
app.use(express.static('public')); // 이제 에러 안 납니다!
app.use(express.json());

// 4. API 라우트들

// [선수 데이터 추가]
app.post('/add-player', async (req, res) => {
    // Neon DB는 SSL 설정이 필수입니다.
    const client = new Client({ 
        connectionString, 
        ssl: { rejectUnauthorized: false } 
    });
    const { name, team, ab, hits, hr, bb } = req.body;

    try {
        await client.connect();
        const playerRes = await client.query(
            'INSERT INTO players (name, team) VALUES ($1, $2) RETURNING id',
            [name, team]
        );
        const playerId = playerRes.rows[0].id;

        await client.query(
            'INSERT INTO hitter_stats (player_id, at_bats, hits, home_runs, walks) VALUES ($1, $2, $3, $4, $5)',
            [playerId, ab, hits, hr, bb]
        );

        res.json({ message: `${name} 선수 데이터 저장 완료!` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        await client.end();
    }
});

// [데이터 조회 및 계산]
app.get('/stats/:name', async (req, res) => {
    const client = new Client({ 
        connectionString, 
        ssl: { rejectUnauthorized: false } 
    });
    try {
        await client.connect();
        const query = `
            SELECT p.name, s.at_bats, s.hits, s.home_runs, s.walks 
            FROM players p 
            JOIN hitter_stats s ON p.id = s.player_id 
            WHERE p.name = $1
        `;
        const result = await client.query(query, [req.params.name]);

        if (result.rows.length > 0) {
            const s = result.rows[0];
            const avg = (s.hits / s.at_bats).toFixed(3);
            const obp = ((s.hits + s.walks) / (s.at_bats + s.walks)).toFixed(3);
            
            res.send(`
                <h1>${s.name} 분석 결과</h1>
                <p>타율(AVG): ${avg}</p>
                <p>출루율(OBP): ${obp}</p>
                <p>기본 스탯: ${s.at_bats}타수 ${s.hits}안타 ${s.home_runs}홈런</p>
            `);
        } else {
            res.status(404).send("선수를 찾을 수 없습니다.");
        }
    } catch (err) {
        res.status(500).send(err.message);
    } finally {
        await client.end();
    }
});

// 5. 서버 실행
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`서버 실행 중: Port ${port}`));
