## What

## Why

## Test plan

- [ ] `npm test`
- [ ] `npm run lint` and `npm run typecheck`
- [ ] Create then open, including a wrong password if crypto or the API changed

## Security

- [ ] No plaintext, password, or URL fragment is stored or logged
- [ ] `wrangler.jsonc` binding names, Durable Object class names, and migration tags are unchanged unless this PR is an intentional migration
