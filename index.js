require('dotenv').config();
const express = require('express');
const { Pool } = require('pg'); // Client보다 안정적인 Pool 사용

const app = express();

// DB 연결 설정
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// 미들웨어 설정
app.use(express.static('public')); 
app.use(express.json());

// [1. 선수 및 상세 성적 데이터 추가 API]
app.post('/add-player', async (req, res) => {
    const { name, team, ab, s1, s2, s3, hr, bb } = req.body;

    try {
        // 1) 선수 정보 저장 (ID 반환)
        const playerRes = await pool.query(
            'INSERT INTO players (name, team) VALUES ($1, $2) RETURNING id',
            [name, team]
        );
        const playerId = playerRes.rows[0].id;

        // 2) 세분화된 성적 정보 저장
        await pool.query(
            'INSERT INTO hitter_stats (player_id, at_bats, s1, s2, s3, hr, walks) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [playerId, ab, s1, s2, s3, hr, bb]
        );

        res.json({ success: true, message: `${name} 선수 데이터 저장 완료!` });
    } catch (err) {
        console.error('데이터 저장 중 오류:', err);
        res.status(500).json({ error: err.message });
    }
});

// [2. 세이버메트릭스 조회 API]
app.get('/stats/:name', async (req, res) => {
    try {
        const playerName = req.params.name.trim(); // 이름 공백 제거

        const query = `
            SELECT p.name, s.at_bats, s.s1, s.s2, s.s3, s.hr, s.walks 
            FROM players p 
            JOIN hitter_stats s ON p.id = s.player_id 
            WHERE p.name = $1
        `;
        
        const result = await pool.query(query, [playerName]);

        if (result.rows.length > 0) {
            const s = result.rows[0];
            
            // --- 계산 로직 ---
            const totalHits = (s.s1 || 0) + (s.s2 || 0) + (s.s3 || 0) + (s.hr || 0);
            const ab = s.at_bats || 1; // 0으로 나누기 방지
            const walks = s.walks || 0;

            // 타율 (AVG)
            const avg = (totalHits / ab).toFixed(3);
            
            // 출루율 (OBP): (안타 + 볼넷) / (타수 + 볼넷)
            const obp = ((totalHits + walks) / (ab + walks)).toFixed(3);
            
            // 장타율 (SLG): 루타수 / 타수
            const totalBases = (s.s1 * 1) + (s.s2 * 2) + (s.s3 * 3) + (s.hr * 4);
            const slg = (totalBases / ab).toFixed(3);
            
            // OPS: 출루율 + 장타율
            const ops = (parseFloat(obp) + parseFloat(slg)).toFixed(3);

            res.send(`
                <div style="font-family: sans-serif; padding: 20px; line-height: 1.6;">
                    <h1>⚾ ${s.name} 분석 결과</h1>
                    <div style="background: #f4f4f4; padding: 15px; border-radius: 10px;">
                        <p><b>타율(AVG):</b> ${avg}</p>
                        <p><b>출루율(OBP):</b> ${obp}</p>
                        <p><b>장타율(SLG):</b> ${slg}</p>
                        <p style="font-size: 1.5em; color: #007bff;"><b>OPS: ${ops}</b></p>
                    </div>
                    <hr>
                    <p><b>상세 기록:</b> ${ab}타수 ${totalHits}안타 (${s.hr}홈런) ${walks}볼넷</p>
                    <button onclick="window.history.back()" style="padding: 10px; cursor: pointer;">뒤로가기</button>
                </div>
            `);
        } else {
            res.status(404).send(`
                <h2>선수를 찾을 수 없습니다.</h2>
                <p>'${playerName}' 선수가 DB에 등록되어 있는지 확인해 주세요.</p>
                <button onclick="window.history.back()">돌아가기</button>
            `);
        }
    } catch (err) {
        console.error('조회 중 오류:', err);
        res.status(500).send("서버 오류가 발생했습니다.");
    }
});

// 서버 시작
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`서버 실행 중: http://localhost:${port}`);
});
