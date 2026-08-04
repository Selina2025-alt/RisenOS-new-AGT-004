// sharp 0.35.0 ships declarations but omits the "types" condition from its
// package exports. Keep this narrow ambient contract until upstream exposes
// lib/index.d.ts to TypeScript's Bundler module resolution.
declare module "sharp" {
  interface SharpMetadata {
    format?: string;
    width?: number;
    height?: number;
    pages?: number;
    exif?: Buffer;
  }

  interface SharpPipeline {
    metadata(): Promise<SharpMetadata>;
    rotate(): SharpPipeline;
    jpeg(options?: { quality?: number }): SharpPipeline;
    png(): SharpPipeline;
    webp(options?: { quality?: number }): SharpPipeline;
    withExif(value: Record<string, Record<string, string>>): SharpPipeline;
    toBuffer(): Promise<Buffer>;
  }

  interface SharpFactory {
    (
      input:
        | Uint8Array
        | {
            create: {
              width: number;
              height: number;
              channels: number;
              background: string;
            };
          },
      options?: {
        failOn?: "none" | "truncated" | "error" | "warning";
        limitInputPixels?: number;
        animated?: boolean;
      },
    ): SharpPipeline;
  }

  const sharp: SharpFactory;
  export default sharp;
}
