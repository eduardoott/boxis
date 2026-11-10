// The reactive state Boxis publishes: `celebrate` changes each time a box is marked as understood,
// so another mod can listen to it and play an effect without a command or a chat line.
declare module 'claude-code' {
  interface PluginState {
    boxis: {
      celebrate: number
      /** Boxes the last click marked, set just before `celebrate` changes. */
      checks: number
    }
  }
}
