const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const fs = require('fs');

// Sử dụng port từ biến môi trường hoặc một port mặc định không đặc quyền
const PORT = process.env.PORT || 3000; 
const STATS_FILE = 'stats.json';

var all_requests = 0;
var per_requests = 0;

require('events').EventEmitter.defaultMaxListeners = Infinity;

// --- Đảm bảo file stats.json tồn tại ---
function ensureStatsFile() {
    if (!fs.existsSync(STATS_FILE)) {
        console.log(`File ${STATS_FILE} not found. Creating with default values.`);
        try {
            fs.writeFileSync(STATS_FILE, JSON.stringify({ max_requests: 0 }));
        } catch (err) {
            console.error(`Error creating ${STATS_FILE}:`, err);
            // Quyết định xem có nên thoát nếu không tạo được file không
            // process.exit(1); 
        }
    }
}

// --- Hàm đọc stats an toàn ---
async function readStats() {
    ensureStatsFile(); // Đảm bảo file tồn tại trước khi đọc
    try {
        const config = await fs.promises.readFile(STATS_FILE, 'utf8');
        return JSON.parse(config);
    } catch (err) {
        console.error(`Error reading or parsing ${STATS_FILE}:`, err);
        // Trả về giá trị mặc định nếu đọc lỗi
        return { max_requests: 0 }; 
    }
}

// --- Hàm ghi stats an toàn ---
async function writeStats(data) {
    try {
        await fs.promises.writeFile(STATS_FILE, JSON.stringify(data, null, 2)); // Thêm null, 2 để format đẹp hơn
    } catch (err) {
        console.error(`Error writing to ${STATS_FILE}:`, err);
    }
}

app.use(express.static(path.join(__dirname, 'assets/')));

app.get('/attack', (req, res) => {
    all_requests++;
    per_requests++;
    // Không cần gửi 403 trừ khi có lý do cụ thể, có thể chỉ cần gửi 200 OK
    // res.sendStatus(403); 
    res.sendStatus(200); // Hoặc res.send('OK');
});

// --- Logic xử lý requests ---
const requestInterval = setInterval(async () => {
    const stats = await readStats();
    let currentMax = stats.max_requests || 0; // Đảm bảo có giá trị mặc định

    if (per_requests >= currentMax) {
        console.log(`Updating max requests from ${currentMax} to ${per_requests}`);
        await writeStats({ max_requests: per_requests });
        currentMax = per_requests; // Cập nhật max hiện tại để emit đúng
    }

    // Gửi dữ liệu qua socket
    io.emit('requests', all_requests, per_requests, currentMax);
    // Đặt lại bộ đếm mỗi giây
    per_requests = 0; 
}, 1000);

// --- Đặt lại bộ đếm hàng ngày ---
const dailyResetInterval = setInterval(() => {
    console.log('Resetting daily request count.');
    all_requests = 0;
}, 1000 * 60 * 60 * 24); // 86400 giây = 1 ngày

// --- Khởi động server ---
const server = http.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);

    // --- Quan trọng cho GitHub Actions ---
    // Nếu đang chạy trong môi trường CI (GitHub Actions sẽ set CI=true)
    // thì thoát sau khi server khởi động thành công để Action có thể hoàn thành.
    if (process.env.CI) {
        console.log('Running in CI environment. Server started successfully. Exiting gracefully.');
        
        // Dừng các interval để tránh lỗi khi đóng server
        clearInterval(requestInterval);
        clearInterval(dailyResetInterval);

        // Đóng server và thoát process
        server.close(() => {
            console.log('Server closed.');
            process.exit(0); // Thoát với mã thành công
        });

        // Đặt timeout phòng trường hợp server không đóng được
        setTimeout(() => {
            console.error('Server close timed out. Forcing exit.');
            process.exit(1); 
        }, 5000); // Thoát sau 5 giây nếu chưa đóng xong
    }
});

// --- Bắt lỗi server ---
server.on('error', (err) => {
    console.error('Server error:', err);
    // Thoát nếu có lỗi khi khởi động server (ví dụ: port đã được sử dụng)
    process.exit(1); // Thoát với mã lỗi
});

// --- Xử lý tín hiệu đóng ứng dụng (ví dụ: Ctrl+C) ---
function gracefulShutdown() {
    console.log('Received shutdown signal. Closing server...');
    clearInterval(requestInterval);
    clearInterval(dailyResetInterval);
    server.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
    // Force shutdown nếu không đóng được sau một khoảng thời gian
    setTimeout(() => {
        console.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 10000); // 10 giây
}

process.on('SIGTERM', gracefulShutdown); // Tín hiệu kill thông thường
process.on('SIGINT', gracefulShutdown);  // Tín hiệu Ctrl+C
