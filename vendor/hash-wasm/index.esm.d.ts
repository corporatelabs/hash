export interface Argon2Options {
  password: string | Uint8Array;
  salt: Uint8Array;
  iterations: number;
  parallelism: number;
  memorySize: number;
  hashLength: number;
  outputType?: "hex" | "binary" | "encoded";
  secret?: Uint8Array;
}

export function argon2id(options: Argon2Options & { outputType: "binary" }): Promise<Uint8Array>;
export function argon2id(options: Argon2Options): Promise<Uint8Array | string>;
