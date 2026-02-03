// Service Worker for SSE testing without a server
// Intercepts fetch requests and returns synthetic SSE streams

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);

    if (url.pathname === '/tests/heartbeat') {
        e.respondWith(createHeartbeatStream());
    }
});

function createHeartbeatStream() {
    const encoder = new TextEncoder();
    let count = 0;
    let intervalId;

    const stream = new ReadableStream({
        start(controller) {
            const send = () => {
                count++;
                const time = new Date().toLocaleTimeString();
                const data = `data: <div>#${count} - ${time}</div>\n\n`;
                controller.enqueue(encoder.encode(data));
            };

            // Send immediately, then every 2 seconds
            send();
            intervalId = setInterval(send, 2000);
        },
        cancel() {
            clearInterval(intervalId);
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        }
    });
}
