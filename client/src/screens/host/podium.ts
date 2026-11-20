import type { PublicPlayer } from "@shared/types"

export interface PodiumStep {
  place: 1 | 2 | 3
  players: PublicPlayer[]
}

const byName = (a: PublicPlayer, b: PublicPlayer) => a.name.localeCompare(b.name, "pl")

/**
 * The places 1-3 that exist, best first. Players with a tied rank share a step, so a tie for first
 * leaves no second step. Nobody with 0 points stands on the podium.
 */
export function podiumSteps(players: readonly PublicPlayer[]): PodiumStep[] {
  const steps: PodiumStep[] = []
  for (const place of [1, 2, 3] as const) {
    const group = players.filter((player) => player.rank === place && player.score > 0).sort(byName)
    if (group.length > 0) steps.push({ place, players: group })
  }
  return steps
}
