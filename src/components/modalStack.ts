interface ModalStackEntry {
  id: symbol
  close: () => void
}

const modalStack: ModalStackEntry[] = []

export function registerModal(id: symbol, close: () => void) {
  modalStack.push({ id, close })
}

export function unregisterModal(id: symbol) {
  const index = modalStack.findIndex((modal) => modal.id === id)
  if (index >= 0) modalStack.splice(index, 1)
}

export function isTopModal(id: symbol) {
  return modalStack.at(-1)?.id === id
}

export function closeTopModal() {
  const topModal = modalStack.at(-1)
  if (!topModal) return false
  topModal.close()
  return true
}
