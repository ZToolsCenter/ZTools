#!/bin/bash

# ZTools pacman 卸载后脚本：移除命令行唤起启动器符号链接，
# 并刷新桌面数据库与图标缓存。

# 只移除指向 ZTools 启动器的 /usr/bin/ztools，避免误删用户自建的同名命令。
ztools_launcher='/opt/${sanitizedProductName}/resources/ztools/ztools-launcher.sh'
if [ -L '/usr/bin/ztools' ] && [ "$(readlink '/usr/bin/ztools')" = "$ztools_launcher" ]; then
    rm -f '/usr/bin/ztools'
fi

# 刷新桌面入口数据库，缺失命令时静默跳过。
if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# 刷新 hicolor 图标缓存，缺失命令时静默跳过。
if hash gtk-update-icon-cache 2>/dev/null; then
    gtk-update-icon-cache -f /usr/share/icons/hicolor || true
fi
