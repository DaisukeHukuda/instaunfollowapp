/** ユーザー名からアバターに表示する頭文字を決める。
 *  先頭の記号（_ . 等）を飛ばし、最初の英数字を大文字で返す。
 *  記号だけのユーザー名なら先頭文字、空なら「?」。 */
export function avatarInitial(username: string): string {
  const alnum = username.match(/[a-zA-Z0-9]/);
  if (alnum) return alnum[0].toUpperCase();
  return username[0] ?? '?';
}
