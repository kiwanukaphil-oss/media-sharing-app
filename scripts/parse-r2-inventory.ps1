$ErrorActionPreference = 'Stop'
$settings = [System.Xml.XmlReaderSettings]::new()
$settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
$settings.XmlResolver = $null
$settings.MaxCharactersInDocument = 2097152
$inputXml = [Console]::In.ReadToEnd()
$reader = [System.Xml.XmlReader]::Create([System.IO.StringReader]::new($inputXml), $settings)
$document = [System.Xml.XmlDocument]::new()
$document.XmlResolver = $null
try { $document.Load($reader) } finally { $reader.Dispose() }
$root = $document.DocumentElement
if ($root.NamespaceURI -ne 'http://s3.amazonaws.com/doc/2006-03-01/') { throw 'Unexpected inventory namespace.' }

# Extract direct children only; duplicates and nested scalar values must not hide contradictory metadata.
function Read-InventoryScalar($parent, [string]$name, [bool]$required = $true) {
  $nodes = @($parent.ChildNodes | Where-Object { $_.NodeType -eq [System.Xml.XmlNodeType]::Element -and $_.LocalName -eq $name })
  if ($nodes.Count -gt 1 -or ($required -and $nodes.Count -ne 1)) { throw 'Inventory scalar is missing or duplicated.' }
  if ($nodes.Count -eq 0) { return $null }
  if ($nodes[0].NamespaceURI -ne $root.NamespaceURI -or @($nodes[0].ChildNodes | Where-Object { $_.NodeType -eq [System.Xml.XmlNodeType]::Element }).Count) { throw 'Invalid inventory scalar.' }
  return $nodes[0].InnerText
}

if ($root.LocalName -notin @('ListBucketResult', 'ListMultipartUploadsResult')) { throw 'Unexpected inventory document.' }
$objects = @()
$uploads = @()
foreach ($element in $root.ChildNodes) {
  if ($element.NodeType -ne [System.Xml.XmlNodeType]::Element) { continue }
  if ($element.NamespaceURI -ne $root.NamespaceURI) { throw 'Unexpected inventory child namespace.' }
  if ($element.LocalName -eq 'CommonPrefixes') { throw 'Delimited inventory is incomplete.' }
  if ($element.LocalName -eq 'Contents') {
    $objects += @{ key = (Read-InventoryScalar $element 'Key'); size = (Read-InventoryScalar $element 'Size')
      etag = (Read-InventoryScalar $element 'ETag'); modifiedAt = (Read-InventoryScalar $element 'LastModified') }
  }
  if ($element.LocalName -eq 'Upload') {
    $uploads += @{ key = (Read-InventoryScalar $element 'Key'); uploadId = (Read-InventoryScalar $element 'UploadId')
      initiatedAt = (Read-InventoryScalar $element 'Initiated') }
  }
}
$result = @{ root = $root.LocalName; bucket = (Read-InventoryScalar $root $(if ($root.LocalName -eq 'ListBucketResult') { 'Name' } else { 'Bucket' }))
  encoding = (Read-InventoryScalar $root 'EncodingType'); truncated = (Read-InventoryScalar $root 'IsTruncated')
  keyCount = (Read-InventoryScalar $root 'KeyCount' $false); objects = $objects; uploads = $uploads
  nextContinuationToken = (Read-InventoryScalar $root 'NextContinuationToken' $false)
  nextKeyMarker = (Read-InventoryScalar $root 'NextKeyMarker' $false)
  nextUploadIdMarker = (Read-InventoryScalar $root 'NextUploadIdMarker' $false) }
[Console]::Out.Write(($result | ConvertTo-Json -Depth 8 -Compress))
