export const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"

export function randomCode(): string {
  let code = ""
  for (let i = 0; i < 4; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  }
  return code
}

export function isRoomCode(code: string): boolean {
  return code.length === 4 && [...code].every((letter) => ALPHABET.includes(letter))
}

// Returns the room code for a /ws/<raw> path segment, or null when it is not valid.
export function parseRoomPath(raw: string): string | null {
  try {
    const code = decodeURIComponent(raw).trim().toUpperCase()
    return isRoomCode(code) ? code : null
  } catch {
    return null
  }
}

export function clientKey(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "local"
}
