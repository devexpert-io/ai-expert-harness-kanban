// Lo que decide una persona. Por ejemplo, aprobar la spec antes de que nadie implemente:
//   import { preguntar } from './persona.mjs';
//   planner: async () => ((await preguntar('¿Apruebas la spec?')) ? 'implementer' : 'parar'),
import { createInterface } from 'node:readline';

// Una sola lectura de la consola para todas las preguntas, para no perder respuestas entre una y otra.
let consola;
let lineas;

export async function preguntar(pregunta) {
  consola ??= createInterface({ input: process.stdin, output: process.stdout });
  lineas ??= consola[Symbol.asyncIterator]();
  consola.resume();
  consola.setPrompt(`${pregunta} (s/n) `);
  consola.prompt();
  const { value = '' } = await lineas.next();
  consola.pause(); // que el harness pueda terminar sin esperar más teclado
  return /^s/i.test(value.trim());
}
