require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');

const app = express();

// 1. DB 연결 설정 (Neon/Render 환경변수 사용)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(express.static('public')); 
app.use(express.json());

// [공통 함수] 선수 확인 및 ID 반환 (중복 방지 로직 포함)
async function getPlayerId(name, team) {
    // 1. 먼저 기존 선수 확인
    const check = await pool.query('SELECT id FROM players WHERE name = $1', [name]);
    if (check.rows.length > 0) {
        return check.rows[0].id;
    }
    // 2. 없으면 새로 등록
    const insert = await pool.query(
        'INSERT INTO players (name, team) VALUES ($1, $2) RETURNING id',
        [name, team]
    );
    return insert.rows[0].id;
}

// --- [투수 섹션] ---

// 2. 투수 데이터 추가
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

// 3. 투수 성적 조회 (ERA, WHIP 계산)
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
            
            // 계산 로직 (분모가 0이 되는 것 방지)
            const era = ((s.earned_runs * 9) / ip).toFixed(2);
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

// --- [타자 섹션] ---

// 4. 타자 데이터 추가
app.post('/add-hitter', async (req, res) => {
    const { name, team, year, ab, s1, s2, s3, hr, bb } = req.body;
    try {
        const playerId = await getPlayerId(name, team);
        await pool.query(
            'INSERT INTO hitter_stats (player_id, year, at_bats, s1, s2, s3, hr, walks) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
            [playerId, year, ab, s1, s2, s3, hr, bb]
        );
        res.json({ success: true, message: `${name} 타자의 ${year}년 데이터 저장 완료!` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. 타자 성적 조회 (AVG, OPS 계산)
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
            const walks = parseInt(s.walks) || 0;
            const totalHits = (s.s1 || 0) + (s.s2 || 0) + (s.s3 || 0) + (s.hr || 0);
            
            // 타율, 출루율, 장타율 계산
            const avg = (totalHits / ab).toFixed(3);
            const obp = ((totalHits + walks) / (ab + walks)).toFixed(3);
            const tb = (s.s1 * 1) + (s.s2 * 2) + (s.s3 * 3) + (s.hr * 4);
            const slg = (tb / ab).toFixed(3);
            const ops = (parseFloat(obp) + parseFloat(slg)).toFixed(3);

            res.send(`
                <div style="font-family: sans-serif; padding: 20px; max-width: 500px; margin: auto; border: 2px solid #007bff; border-radius: 10px;">
                    <h2 style="text-align: center;">⚾ 타자 ${s.name} (${s.year}년)</h2>
                    <p style="text-align: center;">소속: ${s.team}</p>
                    <hr>
                    <div style="background: #f0f7ff; padding: 15px; border-radius: 8px;">
                        <p><b>타율 (AVG):</b> ${avg}</p>
                        <p><b>출루율 (OBP):</b> ${obp}</p>
                        <p><b>장타율 (SLG):</b> ${slg}</p>
                        <p style="font-size: 1.4em; color: blue;"><b>OPS: ${ops}</b></p>
                    </div>
                    <hr>
                    <p>상세: ${ab}타수 ${totalHits}안타 ${s.hr}홈런 ${walks}볼넷</p>
                    <button onclick="window.history.back()" style="width: 100%; padding: 10px; cursor: pointer;">뒤로가기</button>
                </div>
            `);
        } else {
            res.status(404).send("타자 데이터를 찾을 수 없습니다.");
        }
    } catch (err) {
        res.status(500).send("서버 오류");
    }
});

// 6. 서버 실행
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`서버가 포트 ${port}에서 실행 중입니다.`);
});
