import { access, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { hostingConfig } from "./hosting";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

// Packages Sites metadata and migrations after Vite finishes compiling.
export function sites(): Plugin {
  let root = process.cwd();

  return {
    name: "sites",
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    async closeBundle() {
      const outputDirectory = resolve(root, "dist", ".openai");
      const drizzleSource = resolve(root, "drizzle");

      await rm(outputDirectory, { recursive: true, force: true });
      await mkdir(outputDirectory, { recursive: true });

      /* O manifesto é ESCRITO, não copiado. A origem era `.openai/hosting.json`,
         apagado do repositório junto com o resto do andaime da OpenAI; a cópia
         virava silenciosamente um não-faz-nada e o validador do artefato falhava
         logo depois, reclamando de um arquivo que ninguém mais produzia. */
      await writeFile(
        resolve(outputDirectory, "hosting.json"),
        `${JSON.stringify(hostingConfig, null, 2)}\n`,
      );
      if (await exists(drizzleSource)) {
        await cp(drizzleSource, resolve(outputDirectory, "drizzle"), {
          recursive: true,
        });
      }
    },
  };
}
