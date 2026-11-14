"""Small same-transaction batches; no cache or permission decision reuse."""


def read_documents(client, transaction, references):
    if type(references) not in {tuple, list} or not 1 <= len(references) <= 4:
        raise ValueError("Invalid bounded read")
    names = [reference._document_path for reference in references]
    if any(type(name) is not str or not name for name in names) or len(set(names)) != len(names):
        raise ValueError("Invalid document references")
    expected, values = set(names), {}
    for row in client.get_all(references, transaction=transaction, timeout=4, retry=None):
        name = row.reference._document_path
        if name not in expected or name in values:
            raise ValueError("Unexpected document response")
        value = row.to_dict() if row.exists else None
        if row.exists and type(value) is not dict:
            raise ValueError("Invalid document response")
        values[name] = value
    if set(values) != expected:
        raise ValueError("Incomplete document response")
    return tuple(values[name] for name in names)
