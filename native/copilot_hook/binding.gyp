{
  "targets": [
    {
      "target_name": "copilot_hook",
      "sources": ["copilot_hook.cpp"],
      "include_dirs": [],
      "conditions": [
        ["OS=='win'", {
          "libraries": ["-luser32.lib"]
        }]
      ]
    }
  ]
}
