const steps = [
  { stage: 'planning', role: 'Planner', skill: 'feature-spec', gate: 'Plan y criterios', evidence: 'Mock · plan generado' },
  { stage: 'implementing', role: 'Implementer', skill: 'feature-implementer', gate: 'Implementación aislada', evidence: 'Mock · worktree simulado' },
  { stage: 'validating', role: 'Validator', skill: 'feature-validator', gate: 'Checks independientes', evidence: 'Mock · checks passing' },
  { stage: 'review', role: 'Validator', skill: 'feature-validator', gate: 'PR simulada lista', evidence: 'Mock · PR simulada creada · STOP humano' }
];

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('Ejecución cancelada'));
    }, { once: true });
  });
}

export async function* runMockTask({ delayMs = 450, signal } = {}) {
  for (const step of steps) {
    await wait(delayMs, signal);
    yield { ...step };
  }
}
