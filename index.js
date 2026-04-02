app.use(express.static('public')); // public 폴더 안의 파일을 기본으로 보여줌
require('dotenv').config();
const { Client } = require('pg');
const express = require('express');
const app = express();

app.use(express.json()); // JSON 데이터를 읽기 위한 설정

const connectionString = process.env.DATABASE_URL;

// 1. 선수 및 성적 데이터 추가 API
app.post('/add-player', async (req, res) => {
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    const { name, team, ab, hits, hr, bb } = req.body; // 타수, 안타, 홈런, 볼넷

    try {
        await client.connect();
        // 선수 정보 저장
        const playerRes = await client.query(
            'INSERT INTO players (name, team) VALUES ($1, $2) RETURNING id',
            [name, team]
        );
        const playerId = playerRes.rows[0].id;

        // 성적 정보 저장 (단순화를 위해 1, 2, 3루타는 일단 생략하거나 0으로 설정)
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

// 2. 세이버메트릭스 계산 및 조회 API
app.get('/stats/:name', async (req, res) => {
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
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
            // 간단한 세이버메트릭스 계산
            const avg = (s.hits / s.at_bats).toFixed(3); // 타율
            const obp = ((s.hits + s.walks) / (s.at_bats + s.walks)).toFixed(3); // 출루율(약식)
            
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

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`서버 실행 중: http://localhost:${port}`));
