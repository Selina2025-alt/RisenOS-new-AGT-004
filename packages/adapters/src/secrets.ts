import type { SecretPort } from "@risen/content-core";

export class EnvironmentSecretPort implements SecretPort {
  async get(name: string): Promise<string | undefined> {
    return process.env[name];
  }
}
