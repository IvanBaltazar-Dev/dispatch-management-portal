[CmdletBinding()]
param()

$generador = [Security.Cryptography.RandomNumberGenerator]::Create()
$sha256 = [Security.Cryptography.SHA256]::Create()
try {
    $bytes = New-Object byte[] 24
    $generador.GetBytes($bytes)
    $clave = [Convert]::ToBase64String($bytes).Replace('+', '-').Replace('/', '_')
    $verificador = $sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes($clave))
    [pscustomobject]@{
        Usuario = 'yiwu'
        ClaveDelPanel = $clave
        YIWU_OWNER_PASSWORD_HASH = [Convert]::ToBase64String($verificador).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    } | Format-List
}
finally {
    $generador.Dispose()
    $sha256.Dispose()
}
