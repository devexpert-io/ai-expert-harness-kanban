const tasks = {
  'DX-184': {
    id: 'DX-184',
    title: 'Wishlist persistente',
    role: 'Implementer',
    skill: 'feature-implementer',
    objective: 'Implementa una wishlist persistente con criterios verificables y tests enfocados.'
  },
  'DX-185': {
    id: 'DX-185',
    title: 'Filtro por tallas',
    role: 'Implementer',
    skill: 'feature-implementer',
    objective: 'Implementa el filtro por tallas sin alterar el orden estable del catálogo.'
  },
  'DX-179': {
    id: 'DX-179',
    title: 'Resumen de pedido',
    role: 'Implementer',
    skill: 'feature-implementer',
    objective: 'Completa el resumen de pedido con desglose verificable y tests de componente.'
  },
  'DX-180': {
    id: 'DX-180',
    title: 'Estado vacío del carrito',
    role: 'Validator',
    skill: 'feature-validator',
    objective: 'Valida de forma independiente el estado vacío del carrito y aporta evidencia reproducible.'
  }
};

export function getTaskDefinition(id) {
  return tasks[id] ? { ...tasks[id] } : null;
}

export function listTaskDefinitions() {
  return Object.values(tasks).map((task) => ({ ...task }));
}
