// The reactive state Boxis publishes: `celebrate` changes each time a box is marked as understood,
// so another mod (Pixelband, with its local patch) can play an effect without a command or a chat line.
declare module 'claude-code' {
  interface PluginState {
    boxis: {
      celebrate: number
    }
  }
}
