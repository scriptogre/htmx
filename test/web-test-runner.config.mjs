import {
  summaryReporter,
  defaultReporter
} from '@web/test-runner'

const config = {
  testRunnerHtml: (testFramework) => `
  <html lang="en">
<head>
    <meta charset="utf-8" />
    <title>htmx Tests</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="htmx-config" content='{"logAll":false}'>
</head>
<body>

<h2>Htmx Test Suite</h2>

<script src="node_modules/chai/chai.js"></script>
<script src="test/lib/fetch-mock.js"></script>
<script src="src/htmx.kernel.js"></script>
<script src="src/htmx.core.js"></script>
<script src="src/ext/hx-sse.js"></script>
<script src="src/ext/hx-ws.js"></script>

<script class="mocha-init">
    window.should = window.chai.should()
    window.assert = window.chai.assert
</script>

<script src="test/lib/helpers.js"></script>
<script type="module" src="${testFramework}"></script>

<div id="test-playground"></div>

</body>
</html>`,

  nodeResolve: true,
  coverage: true,
  coverageConfig: {
    include: ['src/htmx.kernel.js', 'src/htmx.core.js']
  },
  files: [
    'test/tests/**/*.js',
    // Exclude extensions that still use htmx.registerExtension (old API)
    '!test/tests/ext/hx-alpine-compat.js',
    '!test/tests/ext/hx-optimistic.js',
    '!test/tests/ext/hx-preload.js',
    '!test/tests/ext/hx-upsert.js',
  ],
  reporters: [summaryReporter({ flatten: false, reportTestLogs: false, reportTestErrors: true }), defaultReporter({ reportTestProgress: true, reportTestResults: true })]
}

export default config
