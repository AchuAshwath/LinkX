/** One visible admission result, without saving transient browser content. */
export function createAcknowledgement() {
  let settled = false
  let complete: (accepted: boolean) => void = () => {}
  const promise = new Promise<boolean>((resolve) => {
    complete = resolve
  })
  return {
    promise,
    resolve(accepted: boolean) {
      if (settled) return
      settled = true
      complete(accepted)
    },
  }
}
