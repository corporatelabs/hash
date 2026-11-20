declare module "cloudflare:workers" {
  // Interface merge used by the Workers Vitest plugin. It is empty on purpose.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}
