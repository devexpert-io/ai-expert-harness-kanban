export class ProjectSession {
  #project = null;

  get() { return this.#project; }

  clear() { this.#project = null; }

  async choose(chooser) {
    const project = await chooser();
    if (project) this.#project = project;
    return project;
  }
}
