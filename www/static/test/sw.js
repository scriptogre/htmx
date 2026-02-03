// Service Worker for SSE testing without a backend server
// Intercepts fetch requests and returns synthetic SSE streams

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

const SSE_HEADERS = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache'
};

const routes = {
    '/test/manual/heartbeat': createHeartbeatStream,
    '/test/manual/matrix-stream': createMatrixStream,
    '/test/manual/events': createEventsStream,
    '/test/manual/progress-stream': createProgressStream,
    // Legacy paths (for sse.html compatibility)
    '/matrix-stream': createMatrixStream,
    '/events': createEventsStream,
    '/progress-stream': createProgressStream
};

self.addEventListener('fetch', (e) => {
    const handler = routes[new URL(e.request.url).pathname];
    if (handler) e.respondWith(handler());
});

function createHeartbeatStream() {
    const encoder = new TextEncoder();
    let count = 0, intervalId;

    const stream = new ReadableStream({
        start(controller) {
            const send = () => {
                count++;
                controller.enqueue(encoder.encode(`data: <div>#${count} - ${new Date().toLocaleTimeString()}</div>\n\n`));
            };
            send();
            intervalId = setInterval(send, 2000);
        },
        cancel() { clearInterval(intervalId); }
    });

    return new Response(stream, { headers: SSE_HEADERS });
}

function createMatrixStream() {
    const encoder = new TextEncoder();
    const fullText = "Wake up, Neo... The Matrix has you.";
    let index = 0, timeoutId;

    const stream = new ReadableStream({
        start(controller) {
            const typeChar = () => {
                if (index < fullText.length) {
                    index++;
                    controller.enqueue(encoder.encode(`data: <div class="matrix-text">${fullText.slice(0, index)}</div>\n\n`));
                    timeoutId = setTimeout(typeChar, index === 16 ? 250 : 20 + Math.random() * 20);
                } else {
                    timeoutId = setTimeout(deleteChars, 750);
                }
            };
            const deleteChars = () => {
                if (index > 0) {
                    index--;
                    controller.enqueue(encoder.encode(`data: <div class="matrix-text">${fullText.slice(0, index)}</div>\n\n`));
                    timeoutId = setTimeout(deleteChars, 20);
                } else {
                    controller.enqueue(encoder.encode(`data: <div>\u200E</div>\n\n`));
                    controller.close();
                }
            };
            typeChar();
        },
        cancel() { clearTimeout(timeoutId); }
    });

    return new Response(stream, { headers: SSE_HEADERS });
}

function createEventsStream() {
    const encoder = new TextEncoder();
    const activities = ['User joined', 'File uploaded', 'Comment added', 'Task completed', 'Message sent'];
    const statuses = ['Paused', 'Active', 'Overdrive'];
    let status = 'Active', statusChangeTimer = Date.now() + 2000, timeoutId;

    const stream = new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode(`data: <hx-partial hx-target="#events-output" hx-swap="beforeend"><div class="events-active"></div></hx-partial>\n\n`));
            controller.enqueue(encoder.encode(`data: <hx-partial hx-target="#system-status" hx-swap="innerHTML">${status}</hx-partial>\n\n`));

            const send = () => {
                const now = Date.now();
                if (now >= statusChangeTimer) {
                    const available = statuses.filter(s => s !== status);
                    status = available[Math.floor(Math.random() * available.length)];
                    controller.enqueue(encoder.encode(`data: <hx-partial hx-target="#system-status" hx-swap="innerHTML">${status}</hx-partial>\n\n`));
                    statusChangeTimer = now + 2000;
                }

                if (status === 'Paused') {
                    timeoutId = setTimeout(send, 100);
                    return;
                }

                const activity = activities[Math.floor(Math.random() * activities.length)];
                controller.enqueue(encoder.encode(`data: <hx-partial hx-target="#activity" hx-swap="beforeend"><div>${activity}</div></hx-partial>\n\n`));
                timeoutId = setTimeout(send, status === 'Overdrive' ? 100 : 500);
            };
            send();
        },
        cancel() { clearTimeout(timeoutId); }
    });

    return new Response(stream, { headers: SSE_HEADERS });
}

function createProgressStream() {
    const encoder = new TextEncoder();
    let progress = 0, timeoutId;

    const stream = new ReadableStream({
        start(controller) {
            const update = () => {
                if (progress < 100) {
                    progress += Math.floor(Math.random() * 5) + 5;
                    if (progress > 100) progress = 100;
                    controller.enqueue(encoder.encode(`event: progress\ndata: ${progress}\n\n`));
                    timeoutId = setTimeout(update, 50);
                } else {
                    controller.enqueue(encoder.encode(`event: done\ndata: complete\n\n`));
                    controller.close();
                }
            };
            update();
        },
        cancel() { clearTimeout(timeoutId); }
    });

    return new Response(stream, { headers: SSE_HEADERS });
}
