# Disaster Recovery Plan

## Backup Frequency
- Daily backups of the MongoDB database are scheduled using the `mongodump` command.

## Backup Command Example
```bash
mongodump --uri="mongodb://<username>:<password>@127.0.0.1:27017/capstone-vetclinic" --out=/path/to/backups/$(date +%F)
