//==========================================================
// hx-download.js
//
// An extension that adds a 'download' swap style which
// triggers a file download instead of a DOM swap, with
// streaming progress events for progress bars.
//
// Usage:
//   <button hx-get="/file.pdf" hx-swap="download"
//           hx-ext="download">Download</button>
//
// Events:
//   htmx:download:start    {total}
//   htmx:download:progress {loaded, total, percent}
//   htmx:download:complete {filename, size}
//==========================================================
(() => {
    htmx.registerExtension('download', {
        htmx_before_request: (elt, detail) => {
            if (detail.swap?.style !== 'download') return;
            let originalExecute = detail.request.execute;
            detail.request.execute = async () => {
                let response = await originalExecute();
                let total = +response.headers.get('Content-Length') || null;
                htmx.emit(detail.element, 'htmx:download:start', {total});

                let reader = response.body.getReader();
                let chunks = [], loaded = 0;
                while (true) {
                    let {done, value} = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    loaded += value.length;
                    htmx.emit(detail.element, 'htmx:download:progress', {
                        loaded, total,
                        percent: total ? Math.round(loaded / total * 100) : null
                    });
                }

                detail._download = {
                    blob: new Blob(chunks, {
                        type: response.headers.get('Content-Type') || 'application/octet-stream'
                    }),
                    filename: parseFilename(response.headers, detail.request.action)
                };
                return new Response('', {status: response.status, headers: response.headers});
            };
        },

        htmx_before_swap: (elt, detail) => {
            if (!detail._download) return;
            let {blob, filename} = detail._download;
            let url = URL.createObjectURL(blob);
            let a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
            htmx.emit(detail.element, 'htmx:download:complete', {filename, size: blob.size});
            return false;
        }
    });

    function parseFilename(headers, url) {
        let cd = headers.get('Content-Disposition');
        if (cd) {
            let match = cd.match(/filename\*?=['"]?(?:UTF-8'')?([^'";]+)/i);
            if (match) return decodeURIComponent(match[1]);
        }
        return url.split('/').pop().split('?')[0] || 'download';
    }
})();
