module.exports = {
    apps: [
        {
            name: 'hapi-hub',
            cwd: '/Users/illuz/github/hapi',
            script: '/Users/illuz/github/hapi/cli/dist-exe/bun-darwin-arm64/hapi',
            args: 'hub --no-relay',
            interpreter: 'none',
            autorestart: true,
            watch: false,
            merge_logs: true,
            env: {
                HAPI_LISTEN_HOST: '127.0.0.1',
                HAPI_LISTEN_PORT: '3006',
                HAPI_PUBLIC_URL: 'https://hapi.mystery-vr.com'
            }
        }
    ]
}
