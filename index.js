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
app.post('/add-player', async (req, res) => {
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    // s1, s2, s3, hr를 각각 받습니다.
    const { name, team, ab, s1, s2, s3, hr, bb } = req.body; 

    try {
        await client.connect();
        const playerRes = await client.query(
            'INSERT INTO players (name, team) VALUES ($1, $2) RETURNING id',
            [name, team]
        );
        const playerId = playerRes.rows[0].id;

        // 세분화된 안타 데이터를 저장
        await client.query(
            'INSERT INTO hitter_stats (player_id, at_bats, s1, s2, s3, hr, walks) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [playerId, ab, s1, s2, s3, hr, bb]
        );

        res.json({ message: `${name} 선수 데이터 저장 완료!` });
    } catch (err) {
        res.status(500).json({ error: err.message });
        app.get('/stats/:name', async (req, res) => {
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    try {
        await client.connect();
        const query = `
            SELECT p.name, s.at_bats, s.s1, s.s2, s.s3, s.hr, s.walks 
            FROM players p 
            JOIN hitter_stats s ON p.id = s.player_id 
            WHERE p.name = $1
        `;
        const result = await client.query(query, [req.params.name]);

        if (result.rows.length > 0) {
            const s = result.rows[0];
            
            // 전체 안타수 = 1루타 + 2루타 + 3루타 + 홈런
            const totalHits = s.s1 + s.s2 + s.s3 + s.hr;
            
            // 타율 (AVG)
            const avg = (totalHits / s.at_bats).toFixed(3);
            
            // 출루율 (OBP)
            const obp = ((totalHits + s.walks) / (s.at_bats + s.walks)).toFixed(3);
            
            // 장타율 (SLG) 계산
            const totalBases = (s.s1 * 1) + (s.s2 * 2) + (s.s3 * 3) + (s.hr * 4);
            const slg = (totalBases / s.at_bats).toFixed(3);
            
            // OPS (출루율 + 장타율)
            const ops = (parseFloat(obp) + parseFloat(slg)).toFixed(3);

            res.send(`
                <h1>${s.name} 분석 결과</h1>
                <p><b>타율(AVG):</b> ${avg}</p>
                <p><b>출루율(OBP):</b> ${obp}</p>
                <p><b>장타율(SLG):</b> ${slg}</p>
                <p><b>OPS:</b> ${ops}</p>
                <hr>
                <p>상세: ${s.at_bats}타수 ${totalHits}안타(${s.hr}홈런) ${s.walks}볼넷</p>
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
        
    } finally {
        await client.end();
    }
});
