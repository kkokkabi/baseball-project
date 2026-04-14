require('dotenv').config();
const express = require('express');
const { Client } = require('pg');

const app = express();
const connectionString = process.env.DATABASE_URL;

// 미들웨어 설정
app.use(express.static('public')); 
app.use(express.json());

// [1. 선수 및 상세 성적 데이터 추가 API]
app.post('/add-player', async (req, res) => {
    const client = new Client({ 
        connectionString, 
        ssl: { rejectUnauthorized: false } 
    });
    
    // 프론트엔드에서 s1, s2, s3, hr, bb를 보내줘야 합니다.
    const { name, team, ab, s1, s2, s3, hr, bb } = req.body;

    try {
        await client.connect();
        
        // 1) 선수 정보 저장
        const playerRes = await client.query(
            'INSERT INTO players (name, team) VALUES ($1, $2) RETURNING id',
            [name, team]
        );
        const playerId = playerRes.rows[0].id;

        // 2) 세분화된 성적 정보 저장 (s.hits 같은 옛날 칼럼은 사용 안 함)
        await client.query(
            'INSERT INTO hitter_stats (player_id, at_bats, s1, s2, s3, hr, walks) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [playerId, ab, s1, s2, s3, hr, bb]
        );

        res.json({ success: true, message: `${name} 선수 데이터 저장 완료!` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    } finally {
        await client.end();
    }
});

// [2. 세이버메트릭스(타율, 출루율, 장타율, OPS) 조회 API]
 =app.get('/stats/:name', async (req, res) => { // async 추가!
    await client.connect(); 
    // ...
}); {
    const client = new Client({ 
        connectionString, 
        ssl: { rejectUnauthorized: false } 
    });

    try {
        await client.connect();
        const playerName = req.params.name.trim(); // 공백 제거
        
        // 쿼리 시 대소문자 무시(ILIKE) 사용 (영문일 경우 유용)
        const query = `
            SELECT p.name, s.at_bats, s.s1, s.s2, s.s3, s.hr, s.walks 
            FROM players p 
            JOIN hitter_stats s ON p.id = s.player_id 
            WHERE p.name ILIKE $1
        `;
        
        const result = await client.query(query, [playerName]);

        console.log("검색된 결과 개수:", result.rows.length); // 디버깅 로그

        if (result.rows.length > 0) {
            // ... (기존 계산 로직)
        } else {
            // 선수가 없는 건지, 데이터가 없는 건지 상세히 응답
            res.status(404).send(`'${playerName}' 선수를 찾을 수 없거나 상세 성적이 등록되지 않았습니다.`);
        }
    } catch (err) {
        console.error("DB 에러:", err);
        res.status(500).send("서버 오류 발생");
    } finally {
        await client.end();
    }
});

    try {
        await client.connect();
        // DB에서 s1, s2, s3, hr 정보를 가져옵니다.
        const query = `
            SELECT p.name, s.at_bats, s.s1, s.s2, s.s3, s.hr, s.walks 
            FROM players p 
            JOIN hitter_stats s ON p.id = s.player_id 
            WHERE p.name = $1
        `;
        const result = await client.query(query, [req.params.name]);

        if (result.rows.length > 0) {
            const s = result.rows[0];
            
            // --- 계산 로직 ---
            const totalHits = (s.s1 || 0) + (s.s2 || 0) + (s.s3 || 0) + (s.hr || 0);
            const ab = s.at_bats || 1; // 0으로 나누기 방지
            const walks = s.walks || 0;

            // 타율 (AVG)
            const avg = (totalHits / ab).toFixed(3);
            
            // 출루율 (OBP)
            const obp = ((totalHits + walks) / (ab + walks)).toFixed(3);
            
            // 장타율 (SLG)
            const totalBases = (s.s1 * 1) + (s.s2 * 2) + (s.s3 * 3) + (s.hr * 4);
            const slg = (totalBases / ab).toFixed(3);
            
            // OPS
            const ops = (parseFloat(obp) + parseFloat(slg)).toFixed(3);

            res.send(`
                <div style="font-family: sans-serif; padding: 20px;">
                    <h1>⚾ ${s.name} 분석 결과</h1>
                    <p><b>타율(AVG):</b> ${avg}</p>
                    <p><b>출루율(OBP):</b> ${obp}</p>
                    <p><b>장타율(SLG):</b> ${slg}</p>
                    <p style="font-size: 1.2em; color: blue;"><b>OPS: ${ops}</b></p>
                    <hr>
                    <p>상세 기록: ${ab}타수 ${totalHits}안타 (${s.hr}홈런) ${walks}볼넷</p>
                </div>
            `);
        } else {
            res.status(404).send("선수를 찾을 수 없습니다.");
        }
    } catch (err) {
        console.error(err);
        res.status(500).send("서버 오류: " + err.message);
    } finally {
        await client.end();
    }
});

// 서버 시작
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`서버 실행 중: http://localhost:${port}`));

