// Lo que decide una persona. Por ejemplo, aprobar la spec antes de que nadie implemente:
//   import { preguntar } from './persona.mjs';
//   planner: async () => ((await preguntar('¿Apruebas la spec?')) ? 'implementer' : 'parar'),
import { createInterface } from 'node:readline/promises';

export async function preguntar(pregunta) {
  const consola = createInterface({ input: process.stdin, output: process.stdout });
  const respuesta = await consola.question(`${pregunta} (s/n) `);
  consola.close();
  return /^s/i.test(respuesta.trim());
}
