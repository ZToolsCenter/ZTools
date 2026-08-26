#!/bin/bash

# ZTools pacman 安装后脚本：创建命令行唤起启动器符号链接，
# 并刷新桌面数据库与图标缓存，确保应用菜单显示 ZTools 图标。

# 命令行唤起启动器：/usr/bin/ztools -> /opt/<product>/resources/ztools/ztools-launcher.sh
ztools_launcher='/opt/${sanitizedProductName}/resources/ztools/ztools-launcher.sh'
if [ -f "$ztools_launcher" ]; then
    chmod +x "$ztools_launcher"
    ln -sf "$ztools_launcher" '/usr/bin/ztools'
fi

# 刷新桌面入口数据库，缺失命令时静默跳过。
if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# 刷新 hicolor 图标缓存，缺失命令时静默跳过。
if hash gtk-update-icon-cache 2>/dev/null; then
    gtk-update-icon-cache -f /usr/share/icons/hicolor || true
fi
