[CmdletBinding()]
param([switch]$ClavePropia)

if ($ClavePropia) {
    $entrada = Read-Host 'Escribe la nueva clave del panel' -AsSecureString
    try {
        $clave = [Net.NetworkCredential]::new('', $entrada).Password
    }
    finally {
        $entrada.Dispose()
    }
    if ([string]::IsNullOrWhiteSpace($clave) -or $clave.Length -gt 512) {
        throw 'Escribe una clave de 1 a 512 caracteres que no sea solo espacios.'
    }
}
else {
    $generador = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $bytes = New-Object byte[] 24
        $generador.GetBytes($bytes)
        $clave = [Convert]::ToBase64String($bytes).Replace('+', '-').Replace('/', '_')
    }
    finally {
        $generador.Dispose()
    }
}

$sha256 = [Security.Cryptography.SHA256]::Create()
try {
    $verificador = $sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes($clave))
    $resultado = [ordered]@{}
    if (-not $ClavePropia) {
        $resultado.ClaveDelPanel = $clave
    }
    $resultado.YIWU_OWNER_PASSWORD_HASH = [Convert]::ToBase64String($verificador).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    [pscustomobject]$resultado | Format-List
}
finally {
    $sha256.Dispose()
}
