// @ts-check
// A variable whose value cannot be used where it is read. Emacs signals an error naming the value and the command stops; here the
// error names the variable and the value, and whatever needed it is skipped. A variable that is not set is not an error:
// it keeps Emacs's default.

export class VariableValueError extends Error {
  /** @param {string} name the variable @param {unknown} value what it holds @param {string} wanted what the reader needs, e.g. "a number" @param {string} [message] Emacs's own words, when it has them */
  constructor(name, value, wanted, message) {
    super(message ?? `${name} is ${JSON.stringify(String(value))}, which is not ${wanted}`);
    this.name = 'VariableValueError';
    this.variable = name;
    this.value = String(value);
  }
}
