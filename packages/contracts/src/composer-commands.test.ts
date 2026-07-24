import { describe, expect, it } from "vitest"
import { COMPOSER_COMMAND_MANIFEST } from "./composer-commands"

function command(path: string) {
  return COMPOSER_COMMAND_MANIFEST.find(entry => entry.path.join(" ") === path)
}

describe("COMPOSER_COMMAND_MANIFEST", () => {
  it("contains canonical command syntax metadata", () => {
    const start = command("start")
    const show = command("show")
    const kill = command("kill")
    const adminCommands = command("admin commands")

    expect(start).toMatchObject({
      id: "pan-start",
      display: "/pan start",
      args: [{ name: "id", required: true, variadic: false }],
      aliases: [],
      category: "Lifecycle",
    })
    expect(start?.options).toContainEqual(expect.objectContaining({
      flags: "--model <model>",
      required: true,
      valueHint: "model",
    }))
    expect(show?.options.map(option => option.flags)).toEqual(expect.arrayContaining([
      "--cv",
      "--context",
      "--health",
    ]))
    expect(kill?.aliases).toEqual(["stop"])
    expect(adminCommands).toMatchObject({
      display: "/pan admin commands",
      category: "Admin",
      options: [{
        flags: "--json",
        description: "Emit machine-readable JSON",
        required: false,
        valueHint: null,
      }],
    })
    expect(command("pi-auth")).toBeUndefined()
    expect(command("help")).toBeUndefined()
  })
})
