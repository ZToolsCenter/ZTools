#!/usr/bin/env sh

# ZTools 命令行唤起启动器。
# 打包时被 electron-builder 放入应用 resources/ztools/ 目录，
# 安装器会将 /usr/bin/ztools 符号链接指向本脚本。

# 脚本实际所在目录（resources/ztools）。通过符号链接调用时先解析真实路径。
SCRIPT_PATH=$0
if [ -L "$SCRIPT_PATH" ]; then
  SCRIPT_PATH=$(readlink -f "$SCRIPT_PATH")
fi
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$SCRIPT_PATH")" && pwd)

for BIN in \
  "$SCRIPT_DIR/../MacOS/ZTools" \
  "$SCRIPT_DIR/../ztools" \
  "$SCRIPT_DIR/../ZTools"
do
  if [ -x "$BIN" ]; then
    exec "$BIN" --ztools-wake
  fi
done

echo "未找到 ZTools 可执行文件（已探测 $SCRIPT_DIR/../MacOS/ZTools、$SCRIPT_DIR/../ztools、$SCRIPT_DIR/../ZTools）" >&2
exit 1
