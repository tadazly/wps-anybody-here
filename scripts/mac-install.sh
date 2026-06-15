#!/bin/sh

# 1. 定义目录并自动创建
plugin_dir="$HOME/Library/Containers/com.kingsoft.wpsoffice.mac/Data/.kingsoft/wps/jsaddons"
mkdir -p "$plugin_dir"
cd "$plugin_dir" || {
    echo "❌ 无法进入目录，请检查WPS是否安装"
    exit 1
}
 
# 2. 定义配置
publish_name="publish.xml"
plugin_content='<jspluginonline enable="enable_dev" name="@wps-anybody-here/addin" url="http://127.0.0.1:18080/addin/" install="http://127.0.0.1:18080" debug="" type="et"/>'
 
# 3. 写入配置文件（兼容Mac语法）
if [ ! -f "$publish_name" ]; then
    cat > "$publish_name" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<jsplugins>
    $plugin_content
</jsplugins>
EOF
elif grep -q 'name="@wps-anybody-here/addin"' "$publish_name"; then
    tmp_file="${publish_name}.tmp.$$"
    awk -v plugin_content="$plugin_content" '
        /<jspluginonline/ && /name="@wps-anybody-here\/addin"/ {
            print "    " plugin_content
            next
        }
        { print }
    ' "$publish_name" > "$tmp_file" && mv "$tmp_file" "$publish_name"
else
    tmp_file="${publish_name}.tmp.$$"
    awk -v plugin_content="$plugin_content" '
        /<\/jsplugins>/ && !inserted {
            print "    " plugin_content
            inserted = 1
        }
        { print }
    ' "$publish_name" > "$tmp_file" && mv "$tmp_file" "$publish_name"
fi
 
# 4. 验证结果
echo "✅ 配置写入完成！文件内容如下："
cat "$publish_name"
echo ""
echo "请完全退出WPS（右键Dock图标-退出），再重新打开生效"