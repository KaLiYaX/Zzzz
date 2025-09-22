const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const puppeteer = require('puppeteer');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Serve the frontend file
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
    console.log('A user connected');
    socket.emit('log', 'Welcome! Please enter a TikTok URL and start.');

    socket.on('start-automation', async ({ videoUrl }) => {
        if (!videoUrl || !videoUrl.includes('tiktok.com')) {
            socket.emit('log', 'Error: Invalid TikTok URL.');
            return;
        }

        socket.emit('log', 'Automation started... Launching browser.');
        let browser = null;
        try {
            browser = await puppeteer.launch({
                headless: false, // `true` to run in background, `false` to see the browser window
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    // Add proxy here if you have one: '--proxy-server=ip:port'
                ]
            });
            const page = await browser.newPage();
            await page.setViewport({ width: 1280, height: 800 });
            socket.emit('log', 'Navigating to Zefoy...');
            await page.goto('https://zefoy.com/', { waitUntil: 'networkidle2' });

            // --- CAPTCHA HANDLING ---
            socket.emit('log', '!! ACTION REQUIRED: Please solve the CAPTCHA in the browser window manually.');
            // Wait for the user to solve CAPTCHA and for the main services page to load
            await page.waitForSelector('input[placeholder*="video URL"]', { timeout: 120000 }); // Wait up to 2 minutes
            socket.emit('log', 'CAPTCHA seems to be solved. Proceeding to likes page...');

            // For this example, we assume the 'Hearts' service is available
            // In a real scenario, you'd need to find the correct button
            // This selector might change.
            const heartsServiceButton = (await page.$$('h5.card-title'))[1]; // Assuming 'Hearts' is the second service
            if (heartsServiceButton) {
                await heartsServiceButton.click();
            } else {
                 throw new Error("Could not find Hearts/Likes service button.");
            }

            await page.waitForNavigation({ waitUntil: 'networkidle2' });
            socket.emit('log', 'On the likes page.');

            let requestCount = 0;
            while (true) {
                try {
                    socket.emit('log', `[Request #${++requestCount}] Entering video URL...`);
                    const urlInput = await page.waitForSelector('input[type="text"][placeholder*="video URL"]');
                    await urlInput.type(videoUrl, { delay: 50 });
                    
                    const searchButton = await urlInput.evaluateHandle(el => el.nextElementSibling);
                    await searchButton.click();
                    socket.emit('log', 'Searching for video...');

                    // Wait for the "Send" button to appear
                    const sendButtonSelector = 'button.btn-primary[style*="background-color: #343a40;"]';
                    await page.waitForSelector(sendButtonSelector, { timeout: 30000 });
                    socket.emit('log', 'Video found. Clicking send button...');
                    await page.click(sendButtonSelector);

                    socket.emit('log', 'Likes sent! Waiting for cooldown timer...');

                    // Wait for the timer to appear, and then disappear
                    await page.waitForSelector('#timer', { visible: true });
                    socket.emit('log', 'Timer detected. Waiting for it to finish...');
                    await page.waitForSelector('#timer', { hidden: true, timeout: 1800000 }); // Wait up to 30 mins
                    socket.emit('log', 'Timer finished. Restarting the process...');
                    await page.reload({ waitUntil: 'networkidle2' }); // Reload to be safe
                } catch (loopError) {
                    socket.emit('log', `An error occurred in the loop: ${loopError.message}. Reloading and retrying...`);
                    await page.reload({ waitUntil: 'networkidle2' });
                }
            }
        } catch (error) {
            socket.emit('log', `FATAL ERROR: ${error.message}`);
            console.error(error);
        } finally {
            if (browser) {
                await browser.close();
                socket.emit('log', 'Browser closed. Session ended.');
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
