/** Terminal-generated replies and mouse reports are not meaningful user input. */
export function isTerminalControlInput(data: string): boolean {
  return /^(?:(?:\x1b\[\??\d+(?:;\d+)*R)|(?:\x1b\[<\d+;\d+;\d+[Mm])|(?:\x1b\[M.{3}))+$/s.test(data)
}
