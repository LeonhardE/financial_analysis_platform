"""Bound transaction lifecycle calls for every Firestore-backed service."""

from google.cloud.firestore_v1.transaction import Transaction


class BoundedTransaction(Transaction):
    """Firestore 2.x transaction lifecycle RPCs otherwise ignore request timeouts.

    The SDK's public transaction decorator supplies conflict retries but its
    lifecycle methods expose no timeout. Keep its serialization/transaction
    state, and explicitly bound those three RPCs as well as document reads.
    """

    def _begin(self, retry_id=None):
        if self.in_progress:
            raise ValueError("Transaction already in progress")
        response = self._client._firestore_api.begin_transaction(
            request={
                "database": self._client._database_string,
                "options": self._options_protobuf(retry_id),
            },
            metadata=self._client._rpc_metadata,
            retry=None,
            timeout=4,
        )
        self._id = response.transaction

    def _commit(self):
        if not self.in_progress:
            raise ValueError("Transaction not started")
        response = self._client._firestore_api.commit(
            request={
                "database": self._client._database_string,
                "writes": self._write_pbs,
                "transaction": self._id,
            },
            metadata=self._client._rpc_metadata,
            retry=None,
            timeout=4,
        )
        self._clean_up()
        self.write_results = list(response.write_results)
        self.commit_time = response.commit_time
        return self.write_results

    def _rollback(self):
        try:
            self._client._firestore_api.rollback(
                request={"database": self._client._database_string, "transaction": self._id},
                metadata=self._client._rpc_metadata,
                retry=None,
                timeout=4,
            )
        finally:
            self._clean_up()
