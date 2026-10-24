
export function urlString(
    strings: TemplateStringsArray,
    ...values: (string | number)[]
): string {
    // 1. 先按模板字符串规则拼接
    let raw = strings.reduce((acc, str, i) => {
        const value = values[i] ?? "";
        return acc + str + value;
    }, "");

    // 2. 去掉 /./ 这种路径
    raw = raw.replace(/\/\.\//g, "/");

    // 3. 合并多余的 //，但保留协议部分
    raw = raw.replace(/([^:]\/)\/+/g, "$1");

    return raw;
}