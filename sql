SELECT DISTINCT ON (ST_AsText(coordinate)) *
FROM noise_spatial_table
ORDER BY ST_AsText(coordinate), time DESC;